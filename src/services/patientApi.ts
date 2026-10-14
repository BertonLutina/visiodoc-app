import { supabase, supabasePublic, supabaseConfigured } from '@/lib/supabase';
import * as Linking from 'expo-linking';
import * as mock from '@/data/mock';
import type {
  Consultation,
  ConsultationType,
  Doctor,
  MedicalRecord,
  Wallet,
} from '@/types';
import { isMedicalRecordKind } from './medicalRecordTaxonomy';
import { normalizeConsultationStatus } from '@/utils/format';
import { appLocale, translate } from '@/i18n/core';

const useMock = () => !supabaseConfigured || !supabase;

const initials = (a?: string, b?: string) =>
  `${(a ?? '').charAt(0)}${(b ?? '').charAt(0)}`.toUpperCase();

// La colonne `specialization` peut être un tableau (text[]) ou une chaîne côté DB.
const specLabel = (s: any): string =>
  Array.isArray(s) ? s.filter(Boolean).join(' · ') : (s ?? '');

/* ---------- Médecins ---------- */
function mapDoctor(row: any): Doctor {
  // La fiche `healthcare_professionals` peut être absente (profil incomplet) :
  // on retombe alors sur les champs de `users`, puis sur des valeurs par défaut.
  const hp = row.healthcare_professionals ?? {};
  const specialty = specLabel(hp.specialization) || specLabel(row.specialization) || 'Médecin';
  return {
    id: row.id,
    firstName: row.first_name ?? '',
    lastName: row.last_name ?? '',
    specialty,
    city: hp.city ?? '',
    fee: hp.consultation_fee ?? row.consultation_fee ?? 0,
    rating: hp.rating ?? 0,
    reviewsCount: hp.total_consultations ?? 0,
    yearsOfExperience: hp.years_of_experience ?? row.years_of_experience ?? 0,
    patientsCount: hp.total_consultations ?? 0,
    availabilityLabel: hp.availability_status === 'available' ? 'Dispo auj.' : 'Sur RDV',
    initials: initials(row.first_name, row.last_name),
    avatarUrl: row.avatar_url ?? undefined,
  };
}

const DOCTOR_COLUMNS = `id, first_name, last_name, specialization, consultation_fee, years_of_experience,
       healthcare_professionals ( specialization, city, consultation_fee, rating,
         years_of_experience, total_consultations, availability_status )`;

/**
 * `avatar_url` est ajouté en tête de sélection ; si les droits colonne de la table `users`
 * ne l'exposent pas à ce rôle, on réessaie sans la photo plutôt que de casser le catalogue.
 */
async function withAvatarFallback<T>(run: (columns: string) => PromiseLike<{ data: T | null; error: any }>) {
  const first = await run(`avatar_url, ${DOCTOR_COLUMNS}`);
  if (!first.error) return first;
  return run(DOCTOR_COLUMNS);
}

export async function getDoctors(): Promise<Doctor[]> {
  if (useMock()) return mock.doctors;
  // Client PUBLIC (anon) : le catalogue des médecins est visible de tous,
  // alors qu'un patient connecté ne verrait que sa propre ligne `users` (RLS).
  const { data, error } = await withAvatarFallback<any[]>((columns) =>
    supabasePublic!.from('users').select(columns).eq('role', 'provider').eq('is_active', true).limit(50),
  );
  if (error) throw error;
  return (data ?? []).map(mapDoctor);
}

export async function getDoctor(id: string): Promise<Doctor | null> {
  if (useMock()) return mock.doctors.find((d) => d.id === id) ?? null;
  const { data, error } = await withAvatarFallback<any>((columns) =>
    supabasePublic!.from('users').select(columns).eq('id', id).single(),
  );
  if (error) throw error;
  return data ? mapDoctor(data) : null;
}

/* ---------- Consultations ---------- */
function mapConsultation(row: any): Consultation {
  const d = row.doctor ?? {};
  return {
    id: row.id,
    doctor: {
      id: d.id ?? row.doctor_id,
      firstName: d.first_name ?? '',
      lastName: d.last_name ?? '',
      specialty: specLabel(d.healthcare_professionals?.specialization),
      initials: initials(d.first_name, d.last_name),
    },
    date: row.scheduled_at,
    dateLabel: new Date(row.scheduled_at).toLocaleString(appLocale(), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }),
    type: (row.consultation_type as ConsultationType) ?? 'video',
    durationMin: row.duration ?? 30,
    fee: row.payment_amount ?? 0,
    status:
      row.status === 'scheduled' && row.payment_status === 'pending'
        ? 'pending'
        : normalizeConsultationStatus(row.status),
    roomId: row.video_room_id ?? undefined,
  };
}

async function fetchConsultations(patientId: string, statuses: string[]): Promise<Consultation[]> {
  const { data, error } = await supabase!
    .from('consultations')
    .select(
      `*, doctor:users!consultations_doctor_id_fkey (
         id, first_name, last_name, healthcare_professionals ( specialization )
       )`,
    )
    .eq('patient_id', patientId)
    .in('status', statuses)
    .order('scheduled_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapConsultation);
}

export async function getUpcomingConsultations(patientId: string): Promise<Consultation[]> {
  if (useMock()) return mock.consultations;
  return fetchConsultations(patientId, ['pending_payment', 'scheduled', 'in_progress']);
}

export async function getPastConsultations(patientId: string): Promise<Consultation[]> {
  if (useMock()) return mock.pastConsultations;
  return fetchConsultations(patientId, ['completed', 'cancelled']);
}

export class SlotUnavailableError extends Error {
  reason: 'overlap' | 'daily-limit';
  constructor(reason: 'overlap' | 'daily-limit') {
    super(
      reason === 'overlap'
        ? translate("Ce créneau vient d'être réservé, choisissez-en un autre.")
        : translate('Vous avez déjà un rendez-vous ce jour-là avec ce professionnel.'),
    );
    this.name = 'SlotUnavailableError';
    this.reason = reason;
  }
}

/** Écran vers lequel la passerelle de paiement ramène l'utilisateur. */
export const RETURN_PATH = '/(patient)/appointments';

export type PaymentMethod = 'CARD' | 'MOBILE_MONEY';

/** Intention de paiement renvoyée par l'Edge Function payment-initiate-v2. */
export type PaymentIntent = {
  txnRef: string;
  actionUrl: string;
  httpMethod: 'POST';
  integrator: string;
  expiresAt: string;
  payload: Record<string, unknown>;
};

export class PaymentInitiationError extends Error {
  /** Id de la consultation déjà créée (statut `scheduled`, paiement `pending`). */
  consultationId: string;
  constructor(consultationId: string, message: string) {
    super(message);
    this.name = 'PaymentInitiationError';
    this.consultationId = consultationId;
  }
}

/** Les montants sont envoyés en plus petite unité (×100), cf. docs Interswitch du backend. */
const toSmallestUnit = (amount: number) => Math.round(amount * 100);

export async function bookConsultation(input: {
  patientId: string;
  doctorId: string;
  scheduledAt: string;
  type: ConsultationType;
  fee: number;
  /** Durée réelle du créneau réservé (minutes) — doit venir du Slot affiché, jamais d'une
   * valeur fixe : la contrainte anti-chevauchement côté DB se base sur cette colonne, donc
   * une valeur fausse réserve la mauvaise plage horaire. */
  duration: number;
  countryCode?: string;
  paymentMethod?: PaymentMethod;
  customerEmail?: string;
  customerName?: string;
}): Promise<{ id: string; paymentIntent?: PaymentIntent }> {
  if (useMock()) return { id: 'mock-booking' };
  // `pending_payment` n'est pas dans le CHECK de consultations.status : on réserve en
  // `scheduled` et le paiement est suivi par `payment_status`.
  const { data, error } = await supabase!
    .from('consultations')
    .insert({
      patient_id: input.patientId,
      doctor_id: input.doctorId,
      scheduled_at: input.scheduledAt,
      duration: input.duration,
      consultation_type: input.type,
      payment_amount: input.fee,
      status: 'scheduled',
      payment_status: 'pending',
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23P01') throw new SlotUnavailableError('overlap');
    if (error.code === '23505' && error.message?.includes('one_booking_per_provider_per_day')) {
      throw new SlotUnavailableError('daily-limit');
    }
    throw error;
  }
  // Paiement : Edge Function payment-initiate-v2
  const { data: intent, error: payError } = await supabase!.functions.invoke('payment-initiate-v2', {
    body: {
      countryCode: input.countryCode ?? 'CD',
      method: input.paymentMethod ?? 'MOBILE_MONEY',
      amountSmallestUnit: toSmallestUnit(input.fee),
      callbackUrl: Linking.createURL(RETURN_PATH),
      patientId: input.patientId,
      providerId: input.doctorId,
      consultationId: data.id,
      customerEmail: input.customerEmail,
      customerName: input.customerName,
    },
  });
  if (payError || !intent || (intent as any).error) {
    const reason = (intent as any)?.error ?? payError?.message ?? 'unknown';
    throw new PaymentInitiationError(
      data.id,
      translate("Rendez-vous réservé, mais le paiement n'a pas pu démarrer. Réessayez depuis vos rendez-vous.") +
        ` (${reason})`,
    );
  }
  return { id: data.id, paymentIntent: intent as PaymentIntent };
}

/* ---------- Dossier médical ---------- */
export function mapMedicalRecordRow(row: any): MedicalRecord {
  return {
    id: row.id,
    patientId: row.patient_id,
    doctorId: row.doctor_id,
    consultationId: row.consultation_id ?? undefined,
    kind: isMedicalRecordKind(row.record_type) ? row.record_type : 'note',
    title: row.title ?? '',
    description: row.description ?? undefined,
    category: row.category ?? undefined,
    severity: row.severity ?? undefined,
    status: row.status ?? 'active',
    author: '',
    date: new Date(row.date_recorded ?? row.created_at).toLocaleDateString(appLocale()),
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    metadata: row.metadata ?? {},
  };
}

export async function getMedicalRecords(patientId: string): Promise<MedicalRecord[]> {
  if (useMock()) return mock.medicalRecords;
  const { data, error } = await supabase!
    .from('medical_records')
    .select(
      'id, patient_id, doctor_id, consultation_id, record_type, title, description, category, severity, status, date_recorded, start_date, end_date, attachments, metadata, created_at',
    )
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapMedicalRecordRow);
}

/* ---------- Portefeuille ----------
 * Note : pas de table de solde patient confirmée dans le backend web
 * (les paiements passent par payment_transactions / escrows).
 * On garde le mock ; à câbler en Phase 2+ quand la table sera définie. */
export async function getWallet(_patientId: string): Promise<Wallet> {
  return mock.wallet;
}
