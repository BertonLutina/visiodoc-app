import { supabase, supabasePublic, supabaseConfigured } from '@/lib/supabase';
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
import { videoRoomId } from './videoToken';
import { fromDbConsultationType, normalizeConsultationStatus, toDbConsultationType } from '@/utils/format';
import { appLocale, translate } from '@/i18n/core';
import {
  payConsultation,
  payExistingConsultation as payExisting,
  type OpenPaymentWidget,
  type PayExistingResult,
} from './paymentAttempt';

const useMock = () => !supabaseConfigured || !supabase;

const initials = (a?: string, b?: string) =>
  `${(a ?? '').charAt(0)}${(b ?? '').charAt(0)}`.toUpperCase();

const LABEL_LOCALES = ['fr', 'en'] as const;

/**
 * Une spécialité peut arriver sous plusieurs formes : chaîne, tableau (text[]), ou jsonb indexé par
 * langue (`specialties.labels` = { fr: '…', en: '…' }, ce que renvoie `public_provider_listing`).
 * Toujours rendre une chaîne : un objet passé à <Text> fait planter React.
 */
const specLabel = (s: unknown): string => {
  if (typeof s === 'string') return s;
  if (Array.isArray(s)) return s.map(specLabel).filter(Boolean).join(' · ');
  if (s && typeof s === 'object') {
    const labels = s as Record<string, unknown>;
    for (const locale of LABEL_LOCALES) {
      const value = labels[locale];
      if (typeof value === 'string' && value.trim()) return value;
    }
    for (const value of Object.values(labels)) {
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  return '';
};

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
  const specialty = specLabel(row.specialty_labels) || 'Prestataire';
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
    type: fromDbConsultationType(row.consultation_type),
    durationMin: row.duration ?? 30,
    fee: row.payment_amount ?? 0,
    currency: row.currency ?? undefined,
    createdAt: row.created_at ?? undefined,
    // Statut et paiement viennent de la base : `pending_payment` = en attente de paiement, jamais confirmé.
    awaitingPayment: row.status === 'pending_payment',
    status:
      row.status === 'scheduled' && row.payment_status === 'pending'
        ? 'pending'
        : normalizeConsultationStatus(row.status),
    roomId: row.video_room_id || undefined,
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

/** Relit UNE consultation en base (après paiement : `scheduled` + `paid` viennent du serveur, pas d'un état local). */
export async function getConsultationById(id: string): Promise<Consultation | null> {
  if (useMock()) return mock.consultations.find((c) => c.id === id) ?? null;
  const { data, error } = await supabase!
    .from('consultations')
    .select(
      `*, doctor:provider_identity!doctor_id (
         id, first_name, last_name, avatar_url, specialization
       )`,
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapConsultation(data) : null;
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

/** Écran vers lequel l'utilisateur revient après le paiement. */
export const RETURN_PATH = '/(patient)/appointments';

/** Rejet du verrou serveur `consultation_payment_lock` à l'insertion (jamais ré-essayé par un `update`). */
export class BookingRejectedError extends Error {
  reason: 'payment_locked' | 'amount_out_of_range';
  constructor(reason: 'payment_locked' | 'amount_out_of_range') {
    super(
      reason === 'amount_out_of_range'
        ? translate('Le tarif de cette consultation a changé. Actualise la fiche du prestataire puis réessaie.')
        : translate("Cette opération de paiement n'est pas autorisée depuis l'application. Réessaie depuis tes rendez-vous."),
    );
    this.name = 'BookingRejectedError';
    this.reason = reason;
  }
}

export interface BookConsultationInput {
  patientId: string;
  doctorId: string;
  scheduledAt: string;
  type: ConsultationType;
  /** Tarif AFFICHÉ par `public_provider_listing` (`consultation_fee`) : jamais recalculé côté client. */
  fee: number | null;
  /** `currency_code` de la même vue. */
  currencyCode: string | null;
  /** Durée réelle du créneau réservé (minutes) — doit venir du Slot affiché, jamais d'une
   * valeur fixe : la contrainte anti-chevauchement côté DB se base sur cette colonne, donc
   * une valeur fausse réserve la mauvaise plage horaire. */
  duration: number;
}

/**
 * Crée la consultation en attente de paiement (`pending_payment` / `pending`) avec le montant et la
 * devise affichés. Le serveur rejette tout montant hors de ±10 % du tarif officiel
 * (`insert_amount_out_of_range`) et toute écriture de champ de paiement (`payment_fields_locked`, 42501) :
 * ces erreurs sont remontées telles quelles, sans aucun `update` de rattrapage.
 */
export async function bookConsultation(input: BookConsultationInput): Promise<{ id: string }> {
  if (useMock()) return { id: 'mock-booking' };
  if (input.fee === null || !input.currencyCode) {
    throw new Error(translate('Connecte-toi pour voir le tarif et les disponibilités'));
  }
  const { data, error } = await supabase!
    .from('consultations')
    .insert({
      patient_id: input.patientId,
      doctor_id: input.doctorId,
      scheduled_at: input.scheduledAt,
      duration: input.duration,
      consultation_type: toDbConsultationType(input.type),
      status: 'pending_payment',
      payment_status: 'pending',
      payment_amount: input.fee,
      currency: input.currencyCode,
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23P01') throw new SlotUnavailableError('overlap');
    if (error.code === '23505' && error.message?.includes('one_booking_per_provider_per_day')) {
      throw new SlotUnavailableError('daily-limit');
    }
    const message: string = error.message ?? '';
    if (message.includes('insert_amount_out_of_range')) throw new BookingRejectedError('amount_out_of_range');
    if (message.includes('payment_fields_locked')) throw new BookingRejectedError('payment_locked');
    throw error;
  }
  return { id: data.id };
}

export type BookAndPayResult = { id: string } & (
  | { payment: 'confirmed'; txnRef: string }
  | { payment: 'cancelled'; txnRef: string }
  /** Écran quitté / retour passerelle / timeout : issue inconnue, tentative conservée (voir `PaymentWidgetResult`). */
  | { payment: 'dismissed'; txnRef: string; reason: 'user_left' | 'gateway_returned' | 'timeout' }
);

/**
 * insert `pending_payment` → `txnRef` → `register-payment-attempt` → widget → `confirm-consultation-payment`.
 * Toute erreur APRÈS l'insertion porte `consultationId` : la consultation reste `pending_payment`
 * (l'écran « Mes consultations » permet de repayer avec `payExistingConsultation`).
 */
export async function bookAndPayConsultation(
  input: BookConsultationInput,
  openPaymentWidget: OpenPaymentWidget,
  options: { useWallet?: boolean } = {},
): Promise<BookAndPayResult> {
  const { id } = await bookConsultation(input);
  if (useMock()) return { id, payment: 'confirmed', txnRef: 'mock-txn' };
  try {
    const result = await payConsultation({ consultationId: id, openPaymentWidget, useWallet: options.useWallet });
    if (result.status === 'dismissed') return { id, payment: 'dismissed', txnRef: result.txnRef, reason: result.reason };
    return { id, payment: result.status, txnRef: result.txnRef };
  } catch (e: any) {
    if (e && typeof e === 'object') e.consultationId = e.consultationId ?? id;
    throw e;
  }
}

/**
 * Repaie une consultation déjà créée : relit la ligne (refus si déjà payée), rejoue `confirm` si un paiement
 * est resté non confirmé, ne rouvre pas de widget si une tentative incertaine existe (voir
 * `payExistingConsultation` de `paymentAttempt.ts`), sinon nouvelle `txnRef` et même séquence verrouillée.
 */
export async function payExistingConsultation(
  consultationId: string,
  openPaymentWidget: OpenPaymentWidget,
  options: { useWallet?: boolean; override?: boolean } = {},
): Promise<PayExistingResult> {
  try {
    return await payExisting({ consultationId, openPaymentWidget, useWallet: options.useWallet, override: options.override });
  } catch (e: any) {
    if (e && typeof e === 'object') e.consultationId = e.consultationId ?? consultationId;
    throw e;
  }
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
  const read = (select: string) =>
    supabase!
      .from('payment_transactions_v2')
      .select(select)
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(30);
  let { data, error } = await read(
    `id, amount, status, created_at,
       provider:provider_identity!provider_id ( first_name, last_name )`,
  );
  // PGRST200 = relation introuvable pour l'embed (indication de jointure à confirmer sur UAT) : on relit
  // sans le prestataire (noms absents) plutôt que de casser tout le portefeuille. Aucun autre code n'est réessayé.
  if (error?.code === 'PGRST200') {
    ({ data, error } = await read('id, amount, status, created_at'));
  }
  if (error) throw error;
  const rows = (data ?? []) as any[];
  const transactions = rows.map(mapPaymentRow);
  const balance = rows
    .filter((row: { status?: string | null }) => row.status === 'SUCCESS')
    .reduce((sum: number, row: { amount?: number | null }) => sum + (Number(row.amount) || 0) / 100, 0);
  return { ...emptyWallet(), balance, transactions };
}

const safeRoomId = (room: string) => /^[A-Za-z0-9_-]+$/.test(room);

/**
 * Médecin de l'appel, à partir de l'id de consultation ou du salon vidéo. `roomId` est l'identifiant du contrat
 * `get-video-token` : `consultations.video_room_id` si présent, sinon `consultations.id`.
 */
export async function getCallSession(
  room: string,
): Promise<{ doctorName: string; initials: string; roomId: string } | null> {
  if (useMock() || !room || !safeRoomId(room)) return null;
  const { data, error } = await supabase!
    .from('consultations')
    .select('id, video_room_id, doctor:provider_identity!doctor_id ( first_name, last_name )')
    .or(`id.eq.${room},video_room_id.eq.${room}`)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  type DoctorName = { first_name?: string | null; last_name?: string | null };
  const doctor = oneEmbed((data as { doctor?: DoctorName | DoctorName[] | null }).doctor);
  const first = doctor?.first_name ?? '';
  const last = doctor?.last_name ?? '';
  if (!first && !last) return null;
  const { id, video_room_id } = data as { id: string; video_room_id?: string | null };
  return {
    doctorName: `Dr. ${first} ${last}`.trim(),
    initials: initials(first, last) || 'VD',
    roomId: videoRoomId({ id, video_room_id }),
  };
}
