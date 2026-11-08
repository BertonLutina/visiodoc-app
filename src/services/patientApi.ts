import { supabase, supabasePublic, supabaseConfigured } from '@/lib/supabase';
import * as Linking from 'expo-linking';
import * as mock from '@/data/mock';
import type {
  Consultation,
  ConsultationType,
  Doctor,
  MedicalRecord,
  Wallet,
  WalletTransaction,
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

/* ---------- Médecins ----------
 * Catalogue public : la vue `public_provider_listing` est l'unique point d'entrée (jamais la table
 * `users`, dont la RLS renvoie 0 ligne à un visiteur). Pour un visiteur anonyme la vue renvoie
 * `consultation_fee` et `currency_code` à NULL ; pour un utilisateur connecté, le vrai tarif. */
const CATALOG_VIEW = 'public_provider_listing';

const LIST_COLUMNS =
  'id, first_name, last_name, avatar_url, specialty_labels, consultation_fee, currency_code, city, rating';

// Colonnes réellement exposées par la vue, utiles à la fiche médecin.
const DETAIL_COLUMNS =
  'id, first_name, last_name, avatar_url, bio, years_of_experience, qualifications, languages, country_id, city, rating, total_consultations, availability_status, specialty_id, specialty_labels, consultation_fee, currency_code';

/** Qui lit le catalogue : `signedIn` choisit le client de session (tarif visible) plutôt que l'anonyme. */
export type CatalogOptions = { signedIn?: boolean };

const catalogClient = (signedIn?: boolean) => (signedIn ? supabase! : supabasePublic ?? supabase!);

/**
 * Faut-il masquer le tarif et les créneaux ? Oui pour un visiteur, ou quand la vue ne renvoie pas
 * de tarif (`null`) même à un utilisateur connecté.
 */
export function shouldHideCommercialInfo(fee: number | null, signedIn: boolean): boolean {
  return !signedIn || fee === null;
}

const toFee = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function mapDoctor(row: any): Doctor {
  const specialty = specLabel(row.specialty_labels) || 'Médecin';
  return {
    id: row.id,
    firstName: row.first_name ?? '',
    lastName: row.last_name ?? '',
    specialty,
    city: row.city ?? '',
    fee: toFee(row.consultation_fee),
    currencyCode: row.currency_code ?? null,
    rating: Number(row.rating) || 0,
    reviewsCount: row.total_consultations ?? 0,
    yearsOfExperience: row.years_of_experience ?? 0,
    patientsCount: row.total_consultations ?? 0,
    availabilityLabel:
      row.availability_status === undefined || row.availability_status === null
        ? undefined
        : row.availability_status === 'available'
          ? 'Dispo auj.'
          : 'Sur RDV',
    initials: initials(row.first_name, row.last_name),
    avatarUrl: row.avatar_url ?? undefined,
  };
}

export async function getDoctors(options: CatalogOptions = {}): Promise<Doctor[]> {
  if (useMock()) return mock.doctors;
  const { data, error } = await catalogClient(options.signedIn)
    .from(CATALOG_VIEW)
    .select(LIST_COLUMNS)
    .order('rating', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapDoctor);
}

export async function getDoctor(id: string, options: CatalogOptions = {}): Promise<Doctor | null> {
  if (useMock()) return mock.doctors.find((d) => d.id === id) ?? null;
  const { data, error } = await catalogClient(options.signedIn)
    .from(CATALOG_VIEW)
    .select(DETAIL_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapDoctor(data) : null;
}

/* ---------- Consultations ---------- */
/* Identité médecin vue par un patient : vue `provider_identity` (id, first_name, last_name, post_nom,
 * avatar_url, specialization, country_id). La RLS de `users` ne renvoie plus rien à un patient pour un
 * prestataire ; jamais `email` ni `phone`. L'embed many-to-one est un objet à l'exécution, mais
 * supabase-js (sans types générés) peut le typer en tableau. */
const oneEmbed = <T>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : v) ?? undefined;

export function mapConsultation(row: any): Consultation {
  const d = oneEmbed<any>(row.doctor) ?? {};
  return {
    id: row.id,
    doctor: {
      id: d.id ?? row.doctor_id,
      firstName: d.first_name ?? '',
      lastName: d.last_name ?? '',
      specialty: specLabel(d.specialization),
      initials: initials(d.first_name, d.last_name),
      avatarUrl: d.avatar_url ?? undefined,
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
      `*, doctor:provider_identity!doctor_id (
         id, first_name, last_name, avatar_url, specialization
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
 * Pas de solde prépayé côté patient : l'argent passe par `payment_transactions_v2`
 * (montant en plus petite unité, ×100). `balance` est le total des paiements réussis. */

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  SUCCESS: 'Paiement réussi',
  PENDING: 'Paiement en attente',
  FAILED: 'Paiement échoué',
  REFUNDED: 'Paiement remboursé',
  EXPIRED: 'Paiement expiré',
};

type ProviderName = { first_name?: string | null; last_name?: string | null };

export function mapPaymentRow(row: {
  id: string;
  amount?: number | null;
  status?: string | null;
  created_at?: string | null;
  provider?: ProviderName | ProviderName[] | null;
}): WalletTransaction {
  const major = (Number(row.amount) || 0) / 100;
  const status = row.status ?? '';
  // L'embed many-to-one est un objet à l'exécution, mais supabase-js (sans types générés) le type en tableau.
  const provider = (Array.isArray(row.provider) ? row.provider[0] : row.provider) ?? {};
  const who = [provider.first_name, provider.last_name].filter(Boolean).join(' ').trim();
  return {
    id: row.id,
    label: PAYMENT_STATUS_LABEL[status] ?? 'Paiement',
    date: row.created_at
      ? new Date(row.created_at).toLocaleDateString(appLocale(), {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : '',
    amount: status === 'REFUNDED' ? major : -major,
    method: who || undefined,
  };
}

const emptyWallet = (): Wallet => ({
  balance: 0,
  currency: '',
  countryLabel: '',
  aiCreditsLeft: 0,
  transactions: [],
});

export async function getWallet(patientId: string): Promise<Wallet> {
  if (useMock() || !patientId) return emptyWallet();
  const { data, error } = await supabase!
    .from('payment_transactions_v2')
    .select(
      `id, amount, status, created_at,
       provider:provider_identity!provider_id ( first_name, last_name )`,
    )
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  const rows = data ?? [];
  const transactions = rows.map(mapPaymentRow);
  const balance = rows
    .filter((row: { status?: string | null }) => row.status === 'SUCCESS')
    .reduce((sum: number, row: { amount?: number | null }) => sum + (Number(row.amount) || 0) / 100, 0);
  return { ...emptyWallet(), balance, transactions };
}

const safeRoomId = (room: string) => /^[A-Za-z0-9_-]+$/.test(room);

/** Médecin de l'appel, à partir de l'id de consultation ou du salon vidéo. */
export async function getCallSession(room: string): Promise<{ doctorName: string; initials: string } | null> {
  if (useMock() || !room || !safeRoomId(room)) return null;
  const { data, error } = await supabase!
    .from('consultations')
    .select('id, doctor:provider_identity!doctor_id ( first_name, last_name )')
    .or(`id.eq.${room},video_room_id.eq.${room}`)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  type DoctorName = { first_name?: string | null; last_name?: string | null };
  const doctor = oneEmbed((data as { doctor?: DoctorName | DoctorName[] | null }).doctor);
  const first = doctor?.first_name ?? '';
  const last = doctor?.last_name ?? '';
  if (!first && !last) return null;
  return { doctorName: `Dr. ${first} ${last}`.trim(), initials: initials(first, last) || 'VD' };
}
