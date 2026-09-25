import { supabase, supabasePublic, supabaseConfigured } from '@/lib/supabase';
import * as mock from '@/data/mock';
import type {
  Consultation,
  ConsultationType,
  Doctor,
  MedicalRecord,
  Wallet,
} from '@/types';
import { isMedicalRecordKind } from './medicalRecordTaxonomy';

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
  };
}

export async function getDoctors(): Promise<Doctor[]> {
  if (useMock()) return mock.doctors;
  // Client PUBLIC (anon) : le catalogue des médecins est visible de tous,
  // alors qu'un patient connecté ne verrait que sa propre ligne `users` (RLS).
  const { data, error } = await supabasePublic!
    .from('users')
    .select(
      `id, first_name, last_name, specialization, consultation_fee, years_of_experience,
       healthcare_professionals ( specialization, city, consultation_fee, rating,
         years_of_experience, total_consultations, availability_status )`,
    )
    .eq('role', 'provider')
    .eq('is_active', true)
    .limit(50);
  if (error) throw error;
  return (data ?? []).map(mapDoctor);
}

export async function getDoctor(id: string): Promise<Doctor | null> {
  if (useMock()) return mock.doctors.find((d) => d.id === id) ?? null;
  const { data, error } = await supabasePublic!
    .from('users')
    .select(
      `id, first_name, last_name, specialization, consultation_fee, years_of_experience,
       healthcare_professionals ( specialization, city, consultation_fee, rating,
         years_of_experience, total_consultations, availability_status )`,
    )
    .eq('id', id)
    .single();
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
    dateLabel: new Date(row.scheduled_at).toLocaleString('fr-FR', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }),
    type: (row.consultation_type as ConsultationType) ?? 'video',
    durationMin: row.duration ?? 30,
    fee: row.payment_amount ?? 0,
    status: row.status,
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
  return fetchConsultations(patientId, ['pending', 'confirmed', 'in_progress']);
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
        ? "Ce créneau vient d'être réservé, choisissez-en un autre."
        : 'Vous avez déjà un rendez-vous ce jour-là avec ce professionnel.',
    );
    this.name = 'SlotUnavailableError';
    this.reason = reason;
  }
}

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
}): Promise<{ id: string }> {
  if (useMock()) return { id: 'mock-booking' };
  // ⚠️ status:'pending' n'est pas dans le CHECK de la migration locale de `consultations`
  // (scheduled|in_progress|completed|cancelled|no_show) — bug pré-existant, hors périmètre
  // de cette fonctionnalité (voir spec). Si ce CHECK existe tel quel en prod, CET INSERT
  // échoue avant même d'atteindre les contraintes anti-double-réservation ci-dessous
  // (no_overlapping_bookings / one_booking_per_provider_per_day), qui ne sont alors jamais
  // exercées en réalité.
  const { data, error } = await supabase!
    .from('consultations')
    .insert({
      patient_id: input.patientId,
      doctor_id: input.doctorId,
      scheduled_at: input.scheduledAt,
      duration: input.duration,
      consultation_type: input.type,
      payment_amount: input.fee,
      status: 'pending',
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
  // Paiement : Edge Function payment-initiate
  await supabase!.functions.invoke('payment-initiate', {
    body: { consultationId: data.id, amount: input.fee },
  });
  return { id: data.id };
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
    date: new Date(row.date_recorded ?? row.created_at).toLocaleDateString('fr-FR'),
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
