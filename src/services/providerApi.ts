import { supabase, supabaseConfigured } from '@/lib/supabase';
import * as mock from '@/data/mockProvider';
import type { ConsultationType } from '@/types';
import type {
  AvailabilitySlot,
  ProviderConsultation,
  ProviderPatient,
  ProviderStats,
} from '@/types/provider';

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
  // Patients distincts ayant eu une consultation avec ce médecin
  const { data, error } = await supabase!
    .from('consultations')
    .select(`patient:users!consultations_patient_id_fkey ( id, first_name, last_name ), reason`)
    .eq('doctor_id', doctorId);
  if (error) throw error;
  const seen = new Map<string, ProviderPatient>();
  for (const row of data ?? []) {
    const p: any = (row as any).patient;
    if (p && !seen.has(p.id)) {
      seen.set(p.id, {
        id: p.id,
        firstName: p.first_name ?? '',
        lastName: p.last_name ?? '',
        age: 0,
        gender: 'F',
        mainCondition: (row as any).reason ?? '',
        initials: initials(p.first_name, p.last_name),
      });
    }
  }
  return [...seen.values()];
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
