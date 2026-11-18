import { supabase, supabaseConfigured } from '@/lib/supabase';
import * as mock from '@/data/mockProvider';
import * as patientMock from '@/data/mock';
import { logMedicalRecordEvent } from './auditLog';
import { normalizeGender } from './registration';
import { mapMedicalRecordRow } from './patientApi';
import { calculateChildAge, normalizeChildGender } from './childrenApi';
import { fromDbConsultationType, normalizeConsultationStatus, toDbConsultationType } from '@/utils/format';
import { parseSpecializations, dedupeSpecializations, joinSpecializations } from './specializations';
import type { ConsultationType } from '@/types';
import type {
  AvailabilitySlot,
  PatientDetail,
  ProviderConsultation,
  ProviderPatient,
  ProviderStats,
  DashboardOverview,
  ReviewSummary,
} from '@/types/provider';
import {
  computeDashboardOverview,
  computeProviderEarnings,
  weeklyCapacity,
  EARNING_PAYMENT_STATUS,
  EARNING_STATUSES,
  PAYOUT_PAID_STATUS,
  type DashboardRow,
  type PayoutRow,
  type ProviderEarnings,
} from './dashboardMetrics';
import { getSchedulingSettings, isMissingColumnError } from './availabilityApi';
import type {
  MedicalRecord,
  MedicalRecordAttachment,
  MedicalRecordInput,
  MedicalRecordKind,
  MedicalRecordSeverity,
} from '@/types';
import { appLocale, translate } from '@/i18n/core';

const useMock = () => !supabaseConfigured || !supabase;
const initials = (a?: string, b?: string) =>
  `${(a ?? '').charAt(0)}${(b ?? '').charAt(0)}`.toUpperCase();

/* ---------- Dashboard ---------- */
export async function getDashboardStats(doctorId: string): Promise<ProviderStats> {
  if (useMock()) return mock.providerStats;

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [{ count: patientsTotal }, { count: consultMonth }, hp, earnings] = await Promise.all([
    supabase!
      .from('consultations')
      .select('patient_id', { count: 'exact', head: true })
      .eq('doctor_id', doctorId),
    supabase!
      .from('consultations')
      .select('id', { count: 'exact', head: true })
      .eq('doctor_id', doctorId)
      .gte('scheduled_at', monthStart.toISOString()),
    supabase!
      .from('healthcare_professionals')
      .select('rating, average_rating')
      .eq('user_id', doctorId)
      .maybeSingle(),
    getProviderEarnings(doctorId),
  ]);

  return {
    patientsTotal: patientsTotal ?? 0,
    patientsNew: 0,
    consultationsThisMonth: consultMonth ?? 0,
    consultationsTrend: '',
    // Paiements en cours (hors périodes versées) dans la devise principale : jamais de somme multi-devises.
    netRevenue: earnings.inProgress[0]?.amount ?? 0,
    averageRating: hp.data?.average_rating ?? hp.data?.rating ?? 0,
  };
}

/* ---------- Revenus (contrat serveur : consultations payées + provider_payouts payés) ---------- */
const PAGE_SIZE = 1000; // plafond PostgREST par requête
const MAX_PAGES = 100;

/**
 * Lit toutes les pages d'une requête (`.range`), jusqu'à une page courte ou vide.
 * Une erreur sur n'importe quelle page est propagée : jamais de total partiel silencieux.
 */
async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await page(i * PAGE_SIZE, (i + 1) * PAGE_SIZE - 1);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) return all;
  }
  throw new Error(`Lecture interrompue : trop de lignes (plus de ${MAX_PAGES * PAGE_SIZE}).`);
}

/**
 * Lecture seule, avec le client de SESSION (RLS : le prestataire ne voit que ses lignes).
 * Aucune commission n'est appliquée ici : on lit `payment_amount`, tel que stocké par le serveur.
 * - en cours : `consultations` du médecin, `status in ('completed','no_show')`, `payment_status = 'paid'` ;
 * - versé : `provider_payouts` du médecin (statut `paid`, ou ligne existante si la table n'a pas de statut).
 */
export async function getProviderEarnings(doctorId: string): Promise<ProviderEarnings> {
  if (useMock()) return mock.dashboardOverview.earnings;

  const [consultations, payouts] = await Promise.all([
    fetchAllPages<DashboardRow>((from, to) =>
      supabase!
        .from('consultations')
        .select('id, status, payment_status, payment_amount, currency, scheduled_at')
        .eq('doctor_id', doctorId)
        .in('status', [...EARNING_STATUSES])
        .eq('payment_status', EARNING_PAYMENT_STATUS)
        .order('scheduled_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: DashboardRow[] | null; error: any }>,
    ),
    readPaidPayouts(doctorId),
  ]);
  return computeProviderEarnings(consultations, payouts);
}

/** `null` = pas encore su ; `false` = la table n'a pas de colonne `status` (schéma 20261025150000). */
let payoutsHaveStatus: boolean | null = null;

/** 42703 = colonne inconnue (Postgres) ; PGRST204 = colonne absente du schema cache (PostgREST). */
function isMissingStatusColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  const m = error.message ?? '';
  return /status/i.test(m) && /column|does not exist|schema cache/i.test(m);
}

async function readPaidPayouts(doctorId: string): Promise<PayoutRow[]> {
  const withoutStatus = async () => {
    const retry = await supabase!
      .from('provider_payouts')
      .select('period_start, period_end, net_amount, currency_code')
      .eq('provider_id', doctorId)
      // Sans colonne status, une ligne n'est « versée » que si paid_at est renseigné.
      .not('paid_at', 'is', null);
    if (retry.error) throw retry.error;
    payoutsHaveStatus = false;
    return ((retry.data ?? []) as unknown as PayoutRow[]).map((p) => ({ ...p, status: PAYOUT_PAID_STATUS }));
  };

  if (payoutsHaveStatus === false) return withoutStatus();

  const first = await supabase!
    .from('provider_payouts')
    .select('status, period_start, period_end, net_amount, currency_code')
    .eq('provider_id', doctorId)
    .eq('status', PAYOUT_PAID_STATUS);
  if (!first.error) {
    payoutsHaveStatus = true;
    return (first.data ?? []) as unknown as PayoutRow[];
  }
  if (!isMissingStatusColumn(first.error)) throw first.error;
  return withoutStatus();
}

/* ---------- Dashboard enrichi ---------- */
export async function getDashboardOverview(doctorId: string): Promise<DashboardOverview> {
  if (useMock()) return mock.dashboardOverview;

  const since = new Date(Date.now() - 200 * 86_400_000).toISOString();
  const [data, earningsResult, rules, settings] = await Promise.all([
    fetchAllPages<DashboardRow>((from, to) =>
      supabase!
        .from('consultations')
        .select('id, patient_id, scheduled_at, duration, status, payment_status, payment_amount, currency')
        .eq('doctor_id', doctorId)
        .gte('scheduled_at', since)
        .order('scheduled_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: DashboardRow[] | null; error: any }>,
    ),
    // Un échec de lecture des revenus ne masque pas le reste du tableau de bord, mais il est signalé
    // (`earningsError`) pour ne jamais passer pour « aucun revenu ».
    getProviderEarnings(doctorId).then(
      (earnings) => ({ earnings, failed: false }),
      (): { earnings: ProviderEarnings; failed: boolean } => ({ earnings: { inProgress: [], paid: [] }, failed: true }),
    ),
    getAvailability(doctorId),
    getSchedulingSettings(doctorId),
  ]);
  const { earnings, failed: earningsError } = earningsResult;

  const slotMinutes = settings.appointmentDurationMinutes;
  const { nextRowId, ...rest } = computeDashboardOverview(data, {
    now: new Date(),
    weeklyCapacity: weeklyCapacity(rules, slotMinutes),
  });

  let next: ProviderConsultation | null = null;
  if (nextRowId) {
    const { data: row } = await supabase!
      .from('consultations')
      .select(`*, patient:users!consultations_patient_id_fkey ( id, first_name, last_name ), child:patient_children!child_id ( id, first_name, last_name, date_of_birth, gender )`)
      .eq('id', nextRowId)
      .maybeSingle();
    if (row) next = mapConsultation(row);
  }
  return { ...rest, earnings, earningsError, next };
}

/** Statut de validation du compte prestataire (`provider_profiles.status`), `null` si inconnu. */
export async function getValidationStatus(doctorId: string): Promise<string | null> {
  if (useMock()) return 'VALIDATED';
  const { data } = await supabase!
    .from('provider_profiles')
    .select('status')
    .eq('user_id', doctorId)
    .maybeSingle();
  return (data?.status as string | undefined) ?? null;
}

/** Avis patients : note moyenne dénormalisée + derniers commentaires (table `consultation_reviews`). */
export async function getReviewSummary(doctorId: string, limit = 5): Promise<ReviewSummary> {
  if (useMock()) return mock.reviewSummary;

  const [{ data, error }, hp] = await Promise.all([
    supabase!
      .from('consultation_reviews')
      .select('id, patient_id, rating, comment, created_at')
      .eq('doctor_id', doctorId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase!
      .from('healthcare_professionals')
      .select('average_rating, review_count')
      .eq('user_id', doctorId)
      .maybeSingle(),
  ]);
  if (error) throw error;
  const rows = data ?? [];

  const distribution = [0, 0, 0, 0, 0];
  for (const r of rows) {
    const n = Number(r.rating);
    if (n >= 1 && n <= 5) distribution[n - 1] += 1;
  }

  // Prénoms des auteurs : best-effort, la RLS de `users` peut les masquer.
  const names = new Map<string, string>();
  const ids = [...new Set(rows.filter((r) => r.comment).slice(0, limit).map((r) => r.patient_id as string))];
  if (ids.length) {
    const { data: users } = await supabase!.from('users').select('id, first_name, last_name').in('id', ids);
    for (const u of users ?? []) {
      const last = (u.last_name ?? '').charAt(0);
      names.set(u.id, `${u.first_name ?? ''}${last ? ` ${last}.` : ''}`.trim());
    }
  }

  return {
    average: hp.data?.average_rating != null ? Number(hp.data.average_rating) : null,
    count: hp.data?.review_count ?? rows.length,
    distribution,
    recent: rows
      .filter((r) => r.comment)
      .slice(0, limit)
      .map((r) => ({
        id: r.id,
        author: names.get(r.patient_id) || 'Patient',
        rating: Number(r.rating) || 0,
        comment: r.comment as string,
        date: new Date(r.created_at).toLocaleDateString(appLocale(), { day: 'numeric', month: 'short', year: 'numeric' }),
      })),
  };
}

/* ---------- Consultations ---------- */
/** Enfant d'une consultation (`child_id`) : âge de l'enfant, jamais celui du parent. */
export function mapConsultationChild(row: any): ProviderConsultation['child'] {
  const raw = Array.isArray(row?.child) ? row.child[0] : row?.child;
  if (!row?.child_id || !raw) return undefined;
  return {
    id: row.child_id,
    firstName: raw.first_name ?? '',
    lastName: raw.last_name ?? '',
    ageYears: calculateChildAge(raw.date_of_birth),
    gender: normalizeChildGender(raw.gender),
  };
}

export function mapConsultation(row: any): ProviderConsultation {
  const p = row.patient ?? {};
  return {
    child: mapConsultationChild(row),
    id: row.id,
    patient: {
      id: p.id ?? row.patient_id,
      firstName: p.first_name ?? '',
      lastName: p.last_name ?? '',
      initials: initials(p.first_name, p.last_name),
    },
    reason: row.reason ?? '',
    dateLabel: new Date(row.scheduled_at).toLocaleString(appLocale(), {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }),
    type: fromDbConsultationType(row.consultation_type),
    durationMin: row.duration ?? 30,
    status: normalizeConsultationStatus(row.status),
    rawStatus: row.status,
    scheduledAt: row.scheduled_at,
    roomId: row.video_room_id || undefined,
  };
}

export async function getProviderConsultations(
  doctorId: string,
  statuses: string[],
): Promise<ProviderConsultation[]> {
  if (useMock()) return mock.providerUpcomingConsultations;
  const { data, error } = await supabase!
    .from('consultations')
    .select(
      `*, patient:users!consultations_patient_id_fkey ( id, first_name, last_name ), child:patient_children!child_id ( id, first_name, last_name, date_of_birth, gender )`,
    )
    .eq('doctor_id', doctorId)
    .in('status', statuses)
    .order('scheduled_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapConsultation);
}

export async function getTodayConsultations(doctorId: string): Promise<ProviderConsultation[]> {
  if (useMock()) return mock.providerTodayConsultations;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const { data, error } = await supabase!
    .from('consultations')
    .select(`*, patient:users!consultations_patient_id_fkey ( id, first_name, last_name ), child:patient_children!child_id ( id, first_name, last_name, date_of_birth, gender )`)
    .eq('doctor_id', doctorId)
    // Agenda du jour : seule `pending_payment` (impayée) est exclue ; annulées / absents restent visibles (badges existants).
    .neq('status', 'pending_payment')
    .gte('scheduled_at', start.toISOString())
    .lt('scheduled_at', end.toISOString())
    .order('scheduled_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapConsultation);
}

export async function startConsultation(id: string): Promise<void> {
  if (useMock()) return;
  const { error } = await supabase!
    .from('consultations')
    .update({ status: 'in_progress', started_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/**
 * Variante des écrans : le statut `in_progress` est cosmétique (la porte réelle est `get-video-token`), un
 * refus ou une panne ne doit jamais empêcher un prestataire de rejoindre l'appel. Ne lève jamais ; aucune
 * donnée personnelle journalisée (seulement le code d'erreur).
 */
export async function startConsultationBestEffort(id: string): Promise<void> {
  try {
    await startConsultation(id);
  } catch (e) {
    console.warn('startConsultation failed', (e as { code?: unknown } | null)?.code ?? 'unknown');
  }
}

/* ---------- Patients ---------- */
export async function getPatients(doctorId: string): Promise<ProviderPatient[]> {
  if (useMock()) return mock.providerPatients;
  // Patients distincts ayant eu une consultation avec ce médecin.
  // Les consultations annulées / no-show sont exclues : elles n'établissent pas de relation
  // de soin, et la RLS de `medical_records` les exclut de la même façon (voir le plan, Task 4 :
  // `consultations.status NOT IN ('cancelled', 'no_show')`). Sans ce filtre, un patient dont la
  // seule consultation a été annulée apparaîtrait dans la liste mais son dossier serait vide/refusé.
  const { data, error } = await supabase!
    .from('consultations')
    .select(
      `child_id, child:patient_children!child_id ( id, first_name, last_name, date_of_birth, gender ), patient:users!consultations_patient_id_fkey ( id, first_name, last_name, date_of_birth, gender ), reason`,
    )
    .eq('doctor_id', doctorId)
    .not('status', 'in', '("cancelled","no_show")');
  if (error) throw error;
  return groupPatientRows((data ?? []) as any[]);
}

/**
 * Une ligne par patient adulte et UNE LIGNE PAR ENFANT (consultations.child_id) : un enfant n'est jamais
 * fondu dans la ligne du parent, et son âge et son genre sont ceux de l'enfant, jamais ceux du parent.
 */
export function groupPatientRows(rows: any[]): ProviderPatient[] {
  const seen = new Map<string, ProviderPatient>();
  for (const row of rows) {
    const p: any = row.patient;
    if (!p) continue;
    const rawChild: any = Array.isArray(row.child) ? row.child[0] : row.child;
    if (row.child_id && rawChild) {
      if (seen.has(row.child_id)) continue;
      seen.set(row.child_id, {
        id: row.child_id,
        patientId: p.id,
        childId: row.child_id,
        parentName: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(),
        firstName: rawChild.first_name ?? '',
        lastName: rawChild.last_name ?? '',
        age: calculateChildAge(rawChild.date_of_birth),
        gender: normalizeChildGender(rawChild.gender),
        mainCondition: row.reason ?? '',
        initials: initials(rawChild.first_name, rawChild.last_name),
      });
      continue;
    }
    if (seen.has(p.id)) continue;
    seen.set(p.id, {
      id: p.id,
      patientId: p.id,
      childId: null,
      firstName: p.first_name ?? '',
      lastName: p.last_name ?? '',
      age: calculateAge(p.date_of_birth),
      gender: normalizeGender(p.gender),
      mainCondition: row.reason ?? '',
      initials: initials(p.first_name, p.last_name),
    });
  }
  return [...seen.values()];
}

export async function getLatestRecordByPatient(doctorId: string): Promise<Map<string, MedicalRecord>> {
  const map = new Map<string, MedicalRecord>();
  if (useMock()) {
    for (const r of patientMock.medicalRecords) if (!map.has(r.patientId)) map.set(r.patientId, r);
    return map;
  }
  const { data, error } = await supabase!
    .from('medical_records')
    .select(
      'id, patient_id, child_id, doctor_id, consultation_id, record_type, title, description, category, severity, status, date_recorded, start_date, end_date, attachments, metadata, created_at',
    )
    .eq('doctor_id', doctorId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  for (const row of data ?? []) {
    // Clé = l'enfant du relevé, sinon le patient : les relevés d'un enfant et ceux du parent ne se mélangent pas.
    const key = row.child_id ?? row.patient_id;
    if (!map.has(key)) map.set(key, mapMedicalRecordRow(row));
  }
  return map;
}

export async function getPatientConsultationHistory(
  doctorId: string,
  patientId: string,
  scope?: { childId: string | null },
): Promise<ProviderConsultation[]> {
  if (useMock()) return mock.providerUpcomingConsultations.filter((c) => c.patient.id === patientId);
  let query = supabase!
    .from('consultations')
    .select(`*, patient:users!consultations_patient_id_fkey ( id, first_name, last_name ), child:patient_children!child_id ( id, first_name, last_name, date_of_birth, gender )`)
    .eq('doctor_id', doctorId)
    .eq('patient_id', patientId);
  // Par personne : les consultations du parent et celles de chaque enfant ne se mélangent pas.
  if (scope) query = scope.childId ? query.eq('child_id', scope.childId) : query.is('child_id', null);
  const { data, error } = await query.order('scheduled_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapConsultation);
}

export function calculateAge(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

export async function getPatient(patientId: string): Promise<PatientDetail> {
  if (useMock()) {
    const p = mock.providerPatients.find((x) => x.id === patientId);
    return {
      id: patientId,
      firstName: p?.firstName ?? '',
      lastName: p?.lastName ?? '',
      initials: p?.initials ?? '?',
      age: p?.age ?? null,
      gender: normalizeGender(p?.gender),
      bloodType: null,
      allergiesSummary: null,
      address: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
    };
  }
  const { data, error } = await supabase!
    .from('users')
    .select(
      'id, first_name, last_name, date_of_birth, gender, blood_type, allergies, address, emergency_contact_name, emergency_contact_phone',
    )
    .eq('id', patientId)
    .single();
  if (error) throw error;
  return {
    id: data.id,
    firstName: data.first_name ?? '',
    lastName: data.last_name ?? '',
    initials: initials(data.first_name, data.last_name),
    age: calculateAge(data.date_of_birth),
    gender: normalizeGender(data.gender),
    bloodType: data.blood_type ?? null,
    allergiesSummary: data.allergies ?? null,
    address: data.address ?? null,
    emergencyContactName: data.emergency_contact_name ?? null,
    emergencyContactPhone: data.emergency_contact_phone ?? null,
  };
}

export async function createMedicalRecord(input: MedicalRecordInput): Promise<{ id: string }> {
  if (useMock()) return { id: `mock-${Date.now()}` };
  const { data, error } = await supabase!
    .from('medical_records')
    .insert({
      patient_id: input.patientId,
      doctor_id: input.doctorId,
      consultation_id: input.consultationId ?? null,
      // Relevé d'un enfant : child_id explicite (le serveur le déduit aussi de la consultation et refuse un écart).
      ...(input.childId ? { child_id: input.childId } : {}),
      record_type: input.kind,
      title: input.title,
      description: input.description ?? null,
      category: input.category ?? null,
      severity: input.severity ?? null,
      status: 'active',
      start_date: input.startDate ?? null,
      end_date: input.endDate ?? null,
      metadata: input.metadata ?? {},
    })
    .select('id')
    .single();
  if (error) throw error;
  await logMedicalRecordEvent('medical_record:create', input.doctorId, input.patientId, data.id, input.kind);
  return { id: data.id };
}

export type MedicalRecordContext = { doctorId: string; patientId: string; kind: MedicalRecordKind };

/**
 * Patch d'une entrée de dossier. Pour chaque champ optionnel :
 * - `undefined` = champ non touché (absent du `UPDATE`),
 * - `null`      = champ explicitement vidé (envoyé comme `NULL` à la base).
 * Sans cette distinction, effacer une description était impossible : l'ancienne valeur
 * persistait silencieusement.
 */
export type MedicalRecordPatch = {
  kind?: MedicalRecordKind;
  title?: string;
  description?: string | null;
  category?: string | null;
  severity?: MedicalRecordSeverity | null;
  startDate?: string | null;
  endDate?: string | null;
  metadata?: Record<string, string> | null;
};

export async function updateMedicalRecord(
  id: string,
  context: MedicalRecordContext,
  patch: MedicalRecordPatch,
): Promise<void> {
  if (useMock()) return;
  const dbPatch: Record<string, any> = {};
  if (patch.kind !== undefined) dbPatch.record_type = patch.kind;
  if (patch.title !== undefined) dbPatch.title = patch.title;
  if (patch.description !== undefined) dbPatch.description = patch.description;
  if (patch.category !== undefined) dbPatch.category = patch.category;
  if (patch.severity !== undefined) dbPatch.severity = patch.severity;
  if (patch.startDate !== undefined) dbPatch.start_date = patch.startDate;
  if (patch.endDate !== undefined) dbPatch.end_date = patch.endDate;
  if (patch.metadata !== undefined) dbPatch.metadata = patch.metadata;
  const { error } = await supabase!.from('medical_records').update(dbPatch).eq('id', id);
  if (error) throw error;
  await logMedicalRecordEvent('medical_record:update', context.doctorId, context.patientId, id, context.kind);
}

export async function archiveMedicalRecord(id: string, context: MedicalRecordContext): Promise<void> {
  if (useMock()) return;
  const { error } = await supabase!.from('medical_records').update({ status: 'inactive' }).eq('id', id);
  if (error) throw error;
  await logMedicalRecordEvent('medical_record:archive', context.doctorId, context.patientId, id, context.kind);
}

/* ---------- Disponibilités hebdomadaires ---------- */
const WEEKLY_COLUMNS = 'id, day_of_week, start_time, end_time';
const WEEKLY_COLUMNS_WITH_PERIOD = `${WEEKLY_COLUMNS}, valid_from, valid_to`;
let weeklyPeriodColumns: boolean | null = null;

async function selectWeeklyAvailability(doctorId: string) {
  const run = (columns: string) =>
    supabase!
      .from('doctor_availability')
      .select(columns)
      .eq('doctor_id', doctorId)
      .eq('recurrence_type', 'weekly')
      .eq('is_available', true)
      .order('day_of_week', { ascending: true });

  if (weeklyPeriodColumns !== false) {
    const first = await run(WEEKLY_COLUMNS_WITH_PERIOD);
    if (!first.error) {
      weeklyPeriodColumns = true;
      return first;
    }
    if (!isMissingColumnError(first.error)) return first;
    weeklyPeriodColumns = false;
  }
  return run(WEEKLY_COLUMNS);
}

export async function getAvailability(doctorId: string): Promise<AvailabilitySlot[]> {
  if (useMock()) return mock.providerAvailability;
  const { data, error } = await selectWeeklyAvailability(doctorId);
  if (error) throw error;
  return (data ?? []).map((a: any) => ({
    id: a.id,
    dayOfWeek: a.day_of_week ?? 0,
    startTime: a.start_time,
    endTime: a.end_time,
    slotDuration: 30, // vestige non lu par le nouveau moteur (voir provider_scheduling_settings)
    count: 0,
    validFrom: a.valid_from ? String(a.valid_from).slice(0, 10) : null,
    validTo: a.valid_to ? String(a.valid_to).slice(0, 10) : null,
  }));
}

export type AvailabilityInput = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};

/**
 * Remplace les disponibilités hebdomadaires du médecin (ne touche jamais aux overrides).
 * `period` borne ces règles (inclusif). Si les colonnes ne sont pas encore en base,
 * les horaires sont quand même enregistrés et `periodSynced` vaut false.
 */
export async function saveAvailability(
  doctorId: string,
  ranges: AvailabilityInput[],
  period?: { validFrom: string; validTo: string } | null,
): Promise<{ periodSynced: boolean }> {
  if (useMock()) return { periodSynced: true }; // mode mock : persistance locale côté écran (AsyncStorage)
  const { error: delErr } = await supabase!
    .from('doctor_availability')
    .delete()
    .eq('doctor_id', doctorId)
    .eq('recurrence_type', 'weekly');
  if (delErr) throw delErr;
  if (ranges.length === 0) return { periodSynced: true };
  const rows = ranges.map((r) => ({
    doctor_id: doctorId,
    recurrence_type: 'weekly',
    day_of_week: r.dayOfWeek,
    start_time: r.startTime,
    end_time: r.endTime,
    is_available: true,
  }));
  if (!period) {
    const { error } = await supabase!.from('doctor_availability').insert(rows);
    if (error) throw error;
    return { periodSynced: true };
  }
  const windowed = rows.map((row) => ({ ...row, valid_from: period.validFrom, valid_to: period.validTo }));
  const { error } = await supabase!.from('doctor_availability').insert(windowed);
  if (!error) return { periodSynced: true };
  if (!isMissingColumnError(error)) throw error;
  const retry = await supabase!.from('doctor_availability').insert(rows);
  if (retry.error) throw retry.error;
  return { periodSynced: false };
}

/* ---------- Dates spécifiques (overrides) ---------- */
export type OverrideInput = {
  date: string; // 'YYYY-MM-DD'
  isAvailable: boolean;
  ranges: { startTime: string; endTime: string }[]; // vide si isAvailable=false
  reason?: string | null; // motif d'une indisponibilité (« Congé », « Formation »…)
};

type OverrideRow = {
  specific_date: string;
  start_time: string | null;
  end_time: string | null;
  is_available: boolean;
  exception_reason?: string | null;
};

/** Pure : regroupe les lignes DB (une par plage) en une entrée par date. */
export function groupOverrideRows(rows: OverrideRow[]): OverrideInput[] {
  const byDate = new Map<string, OverrideInput>();
  for (const r of rows) {
    if (!r.is_available) {
      const reason = r.exception_reason?.trim();
      byDate.set(r.specific_date, {
        date: r.specific_date,
        isAvailable: false,
        ranges: [],
        ...(reason ? { reason } : {}),
      });
      continue;
    }
    const range = { startTime: (r.start_time ?? '').slice(0, 5), endTime: (r.end_time ?? '').slice(0, 5) };
    const existing = byDate.get(r.specific_date);
    if (existing && existing.isAvailable) existing.ranges.push(range);
    else byDate.set(r.specific_date, { date: r.specific_date, isAvailable: true, ranges: [range] });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function getOverrides(doctorId: string): Promise<OverrideInput[]> {
  if (useMock()) return [];
  const run = (columns: string) =>
    supabase!
      .from('doctor_availability')
      .select(columns)
      .eq('doctor_id', doctorId)
      .eq('recurrence_type', 'specific_date')
      .order('specific_date', { ascending: true });
  let res = await run('specific_date, start_time, end_time, is_available, exception_reason');
  // Base sans la colonne exception_reason : on lit quand même les dates, sans les motifs.
  if (res.error && isMissingColumnError(res.error)) {
    res = await run('specific_date, start_time, end_time, is_available');
  }
  if (res.error) throw res.error;
  return groupOverrideRows((res.data ?? []) as unknown as OverrideRow[]);
}

type OverrideDbRow = {
  doctor_id: string;
  recurrence_type: string;
  specific_date: string;
  day_of_week: null;
  start_time: string | null;
  end_time: string | null;
  is_available: boolean;
  is_exception?: boolean;
  exception_reason?: string | null;
};

/** Insère les lignes ; si is_exception / exception_reason n'existent pas en base, réessaie sans. */
async function insertOverrideRows(rows: OverrideDbRow[]): Promise<void> {
  const { error } = await supabase!.from('doctor_availability').insert(rows);
  if (!error) return;
  if (!isMissingColumnError(error)) throw error;
  const plain = rows.map(({ is_exception: _e, exception_reason: _r, ...rest }) => rest);
  const retry = await supabase!.from('doctor_availability').insert(plain);
  if (retry.error) throw retry.error;
}

const exceptionRow = (doctorId: string, date: string, reason?: string | null): OverrideDbRow => ({
  doctor_id: doctorId,
  recurrence_type: 'specific_date',
  specific_date: date,
  day_of_week: null,
  start_time: null,
  end_time: null,
  is_available: false,
  is_exception: true,
  exception_reason: reason?.trim() ? reason.trim() : null,
});

/**
 * Marque plusieurs jours indisponibles d'un coup (congé, formation, vacances…). Remplace
 * tout override existant sur ces dates : une exception a priorité sur les horaires.
 */
export async function saveUnavailableDates(
  doctorId: string,
  dates: string[],
  reason?: string | null,
): Promise<void> {
  if (useMock() || dates.length === 0) return;
  const { error: delErr } = await supabase!
    .from('doctor_availability')
    .delete()
    .eq('doctor_id', doctorId)
    .eq('recurrence_type', 'specific_date')
    .in('specific_date', dates);
  if (delErr) throw delErr;
  await insertOverrideRows(dates.map((date) => exceptionRow(doctorId, date, reason)));
}

export async function deleteOverrides(doctorId: string, dates: string[]): Promise<void> {
  if (useMock() || dates.length === 0) return;
  const { error } = await supabase!
    .from('doctor_availability')
    .delete()
    .eq('doctor_id', doctorId)
    .eq('recurrence_type', 'specific_date')
    .in('specific_date', dates);
  if (error) throw error;
}

export async function saveOverride(doctorId: string, input: OverrideInput): Promise<void> {
  if (useMock()) return;
  const { error: delErr } = await supabase!
    .from('doctor_availability')
    .delete()
    .eq('doctor_id', doctorId)
    .eq('recurrence_type', 'specific_date')
    .eq('specific_date', input.date);
  if (delErr) throw delErr;

  const rows: OverrideDbRow[] = input.isAvailable
    ? input.ranges.map((r) => ({
        doctor_id: doctorId,
        recurrence_type: 'specific_date',
        specific_date: input.date,
        day_of_week: null,
        start_time: r.startTime,
        end_time: r.endTime,
        is_available: true,
      }))
    : [exceptionRow(doctorId, input.date, input.reason)];
  await insertOverrideRows(rows);
}

export async function deleteOverride(doctorId: string, date: string): Promise<void> {
  if (useMock()) return;
  const { error } = await supabase!
    .from('doctor_availability')
    .delete()
    .eq('doctor_id', doctorId)
    .eq('recurrence_type', 'specific_date')
    .eq('specific_date', date);
  if (error) throw error;
}

/* ---------- Réglages de réservation ---------- */
export { getSchedulingSettings, saveSchedulingSettings } from './availabilityApi';

export async function appendMedicalRecordAttachment(
  id: string,
  existing: MedicalRecordAttachment[],
  attachment: MedicalRecordAttachment,
): Promise<void> {
  if (useMock()) return;
  const { error } = await supabase!.from('medical_records').update({ attachments: [...existing, attachment] }).eq('id', id);
  if (error) throw error;
}

/* ---------- Consultations pour des enfants (MOB-1311-1 §4, MOB-1711-1) ---------- */
export interface AcceptsChildrenSettings {
  /** null = pas encore de réponse (vide côté serveur). */
  acceptsChildren: boolean | null;
  /** « Ne plus afficher » : mémorisé côté serveur (hide_accepts_children_prompt). */
  hidePrompt: boolean;
}

/** La question « Acceptez-vous les consultations pour des enfants ? » n'est posée que sans réponse ET sans « Ne plus afficher ». */
export function shouldShowAcceptsChildrenPrompt(s: AcceptsChildrenSettings | null | undefined): boolean {
  return !!s && s.acceptsChildren === null && !s.hidePrompt;
}

export function mapAcceptsChildrenRow(
  row: { accepts_children?: boolean | null; hide_accepts_children_prompt?: boolean | null } | null,
): AcceptsChildrenSettings {
  return {
    acceptsChildren: typeof row?.accepts_children === 'boolean' ? row.accepts_children : null,
    hidePrompt: row?.hide_accepts_children_prompt === true,
  };
}

/** Lecture sur SA propre ligne healthcare_professionals (user_id = auth.uid()). */
export async function getAcceptsChildrenSettings(userId: string): Promise<AcceptsChildrenSettings> {
  if (useMock()) return { acceptsChildren: null, hidePrompt: true };
  const { data, error } = await supabase!
    .from('healthcare_professionals')
    .select('accepts_children, hide_accepts_children_prompt')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return mapAcceptsChildrenRow(data);
}

export async function setAcceptsChildren(userId: string, value: boolean): Promise<void> {
  if (useMock()) return;
  const { error } = await supabase!.from('healthcare_professionals').update({ accepts_children: value }).eq('user_id', userId);
  if (error) throw error;
}

/** Case « Ne plus afficher ce message » : hide_accepts_children_prompt = true côté serveur. */
export async function hideAcceptsChildrenPrompt(userId: string): Promise<void> {
  if (useMock()) return;
  const { error } = await supabase!
    .from('healthcare_professionals')
    .update({ hide_accepts_children_prompt: true })
    .eq('user_id', userId);
  if (error) throw error;
}

/* ---------- Spécialisations ---------- */
// `specialization` peut être un text[] ou une chaîne selon la table : on écrit dans le même
// format que celui lu (tableau si la valeur existante est un tableau, sinon chaîne « A · B »).
export async function getMySpecializations(userId: string): Promise<string[]> {
  if (useMock()) return parseSpecializations(mock.currentProvider.specialization);
  const [{ data: u }, { data: hp }] = await Promise.all([
    supabase!.from('users').select('specialization').eq('id', userId).maybeSingle(),
    supabase!.from('healthcare_professionals').select('specialization').eq('user_id', userId).maybeSingle(),
  ]);
  const fromHp = parseSpecializations(hp?.specialization);
  return fromHp.length ? fromHp : parseSpecializations(u?.specialization);
}

export async function saveMySpecializations(userId: string, list: string[]): Promise<string[]> {
  const clean = dedupeSpecializations(list);
  if (clean.length === 0) {
    throw Object.assign(new Error(translate('Choisissez au moins une spécialisation.')), { userFacing: true });
  }
  if (useMock()) return clean;
  const [{ data: u }, { data: hp }] = await Promise.all([
    supabase!.from('users').select('specialization').eq('id', userId).maybeSingle(),
    supabase!.from('healthcare_professionals').select('specialization').eq('user_id', userId).maybeSingle(),
  ]);
  const valueFor = (existing: unknown) => (Array.isArray(existing) ? clean : joinSpecializations(clean));
  const { error: e1 } = await supabase!
    .from('users')
    .update({ specialization: valueFor(u?.specialization) })
    .eq('id', userId);
  if (e1) throw e1;
  if (hp) {
    const { error: e2 } = await supabase!
      .from('healthcare_professionals')
      .update({ specialization: valueFor(hp.specialization) })
      .eq('user_id', userId);
    if (e2) throw e2;
  }
  return clean;
}
