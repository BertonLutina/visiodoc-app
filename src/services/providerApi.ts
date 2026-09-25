import { supabase, supabaseConfigured } from '@/lib/supabase';
import * as mock from '@/data/mockProvider';
import * as patientMock from '@/data/mock';
import { logMedicalRecordEvent } from './auditLog';
import { mapMedicalRecordRow } from './patientApi';
import type { ConsultationType } from '@/types';
import type {
  AvailabilitySlot,
  PatientDetail,
  ProviderConsultation,
  ProviderPatient,
  ProviderStats,
} from '@/types/provider';
import type {
  MedicalRecord,
  MedicalRecordAttachment,
  MedicalRecordInput,
  MedicalRecordKind,
  MedicalRecordSeverity,
} from '@/types';

const useMock = () => !supabaseConfigured || !supabase;
const initials = (a?: string, b?: string) =>
  `${(a ?? '').charAt(0)}${(b ?? '').charAt(0)}`.toUpperCase();

/* ---------- Dashboard ---------- */
export async function getDashboardStats(doctorId: string): Promise<ProviderStats> {
  if (useMock()) return mock.providerStats;

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [{ count: patientsTotal }, { count: consultMonth }, hp] = await Promise.all([
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
      .select('rating')
      .eq('user_id', doctorId)
      .single(),
  ]);

  return {
    patientsTotal: patientsTotal ?? 0,
    patientsNew: 0,
    consultationsThisMonth: consultMonth ?? 0,
    consultationsTrend: '',
    netRevenue: 0,
    averageRating: hp.data?.rating ?? 0,
  };
}

/* ---------- Consultations ---------- */
function mapConsultation(row: any): ProviderConsultation {
  const p = row.patient ?? {};
  return {
    id: row.id,
    patient: {
      id: p.id ?? row.patient_id,
      firstName: p.first_name ?? '',
      lastName: p.last_name ?? '',
      initials: initials(p.first_name, p.last_name),
    },
    reason: row.reason ?? '',
    dateLabel: new Date(row.scheduled_at).toLocaleString('fr-FR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }),
    type: (row.consultation_type as ConsultationType) ?? 'video',
    durationMin: row.duration ?? 30,
    status: row.status,
    roomId: row.video_room_id ?? undefined,
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
      `*, patient:users!consultations_patient_id_fkey ( id, first_name, last_name )`,
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
    .select(`*, patient:users!consultations_patient_id_fkey ( id, first_name, last_name )`)
    .eq('doctor_id', doctorId)
    .gte('scheduled_at', start.toISOString())
    .lt('scheduled_at', end.toISOString())
    .order('scheduled_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapConsultation);
}

export async function startConsultation(id: string): Promise<void> {
  if (useMock()) return;
  await supabase!
    .from('consultations')
    .update({ status: 'in_progress', started_at: new Date().toISOString() })
    .eq('id', id);
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
      `patient:users!consultations_patient_id_fkey ( id, first_name, last_name, date_of_birth, gender ), reason`,
    )
    .eq('doctor_id', doctorId)
    .not('status', 'in', '("cancelled","no_show")');
  if (error) throw error;
  const seen = new Map<string, ProviderPatient>();
  for (const row of data ?? []) {
    const p: any = (row as any).patient;
    if (p && !seen.has(p.id)) {
      seen.set(p.id, {
        id: p.id,
        firstName: p.first_name ?? '',
        lastName: p.last_name ?? '',
        age: calculateAge(p.date_of_birth),
        gender: p.gender === 'M' || p.gender === 'F' ? p.gender : null,
        mainCondition: (row as any).reason ?? '',
        initials: initials(p.first_name, p.last_name),
      });
    }
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
      'id, patient_id, doctor_id, consultation_id, record_type, title, description, category, severity, status, date_recorded, start_date, end_date, attachments, metadata, created_at',
    )
    .eq('doctor_id', doctorId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  for (const row of data ?? []) {
    if (!map.has(row.patient_id)) map.set(row.patient_id, mapMedicalRecordRow(row));
  }
  return map;
}

export async function getPatientConsultationHistory(
  doctorId: string,
  patientId: string,
): Promise<ProviderConsultation[]> {
  if (useMock()) return mock.providerUpcomingConsultations.filter((c) => c.patient.id === patientId);
  const { data, error } = await supabase!
    .from('consultations')
    .select(`*, patient:users!consultations_patient_id_fkey ( id, first_name, last_name )`)
    .eq('doctor_id', doctorId)
    .eq('patient_id', patientId)
    .order('scheduled_at', { ascending: false });
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
      gender: (p?.gender as 'M' | 'F' | undefined) ?? null,
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
    gender: data.gender ?? null,
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
export async function getAvailability(doctorId: string): Promise<AvailabilitySlot[]> {
  if (useMock()) return mock.providerAvailability;
  const { data, error } = await supabase!
    .from('doctor_availability')
    .select('id, day_of_week, start_time, end_time')
    .eq('doctor_id', doctorId)
    .eq('recurrence_type', 'weekly')
    .eq('is_available', true)
    .order('day_of_week', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((a: any) => ({
    id: a.id,
    dayOfWeek: a.day_of_week ?? 0,
    startTime: a.start_time,
    endTime: a.end_time,
    slotDuration: 30, // vestige non lu par le nouveau moteur (voir provider_scheduling_settings)
    count: 0,
  }));
}

export type AvailabilityInput = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};

/** Remplace les disponibilités hebdomadaires du médecin (ne touche jamais aux overrides). */
export async function saveAvailability(
  doctorId: string,
  ranges: AvailabilityInput[],
): Promise<void> {
  if (useMock()) return; // mode mock : persistance locale côté écran (AsyncStorage)
  const { error: delErr } = await supabase!
    .from('doctor_availability')
    .delete()
    .eq('doctor_id', doctorId)
    .eq('recurrence_type', 'weekly');
  if (delErr) throw delErr;
  if (ranges.length === 0) return;
  const rows = ranges.map((r) => ({
    doctor_id: doctorId,
    recurrence_type: 'weekly',
    day_of_week: r.dayOfWeek,
    start_time: r.startTime,
    end_time: r.endTime,
    is_available: true,
  }));
  const { error } = await supabase!.from('doctor_availability').insert(rows);
  if (error) throw error;
}

/* ---------- Dates spécifiques (overrides) ---------- */
export type OverrideInput = {
  date: string; // 'YYYY-MM-DD'
  isAvailable: boolean;
  ranges: { startTime: string; endTime: string }[]; // vide si isAvailable=false
};

type OverrideRow = {
  specific_date: string;
  start_time: string | null;
  end_time: string | null;
  is_available: boolean;
};

/** Pure : regroupe les lignes DB (une par plage) en une entrée par date. */
export function groupOverrideRows(rows: OverrideRow[]): OverrideInput[] {
  const byDate = new Map<string, OverrideInput>();
  for (const r of rows) {
    if (!r.is_available) {
      byDate.set(r.specific_date, { date: r.specific_date, isAvailable: false, ranges: [] });
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
  const { data, error } = await supabase!
    .from('doctor_availability')
    .select('specific_date, start_time, end_time, is_available')
    .eq('doctor_id', doctorId)
    .eq('recurrence_type', 'specific_date')
    .order('specific_date', { ascending: true });
  if (error) throw error;
  return groupOverrideRows((data ?? []) as OverrideRow[]);
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

  type OverrideDbRow = {
    doctor_id: string;
    recurrence_type: string;
    specific_date: string;
    day_of_week: null;
    start_time: string | null;
    end_time: string | null;
    is_available: boolean;
  };
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
    : [
        {
          doctor_id: doctorId,
          recurrence_type: 'specific_date',
          specific_date: input.date,
          day_of_week: null,
          start_time: null,
          end_time: null,
          is_available: false,
        },
      ];
  const { error } = await supabase!.from('doctor_availability').insert(rows);
  if (error) throw error;
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

/* ---------- Tarif (payment_fee_config) ---------- */
export async function getFeeConfig(): Promise<{ currentFee: number; platformFeeRate: number }> {
  if (useMock()) return mock.feeConfig;
  const { data } = await supabase!.from('payment_fee_config').select('*').limit(1).single();
  return {
    currentFee: mock.feeConfig.currentFee,
    platformFeeRate: (data?.platform_fee_percentage ?? 4) / 100,
  };
}

export async function appendMedicalRecordAttachment(
  id: string,
  existing: MedicalRecordAttachment[],
  attachment: MedicalRecordAttachment,
): Promise<void> {
  if (useMock()) return;
  const { error } = await supabase!.from('medical_records').update({ attachments: [...existing, attachment] }).eq('id', id);
  if (error) throw error;
}
