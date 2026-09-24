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

/* ---------- Disponibilités ---------- */
export async function getAvailability(doctorId: string): Promise<AvailabilitySlot[]> {
  if (useMock()) return mock.providerAvailability;
  const { data, error } = await supabase!
    .from('doctor_availability')
    .select('id, day_of_week, start_time, end_time, slot_duration')
    .eq('doctor_id', doctorId)
    .eq('is_available', true)
    .order('day_of_week', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((a: any) => ({
    id: a.id,
    dayOfWeek: a.day_of_week ?? 0,
    startTime: a.start_time,
    endTime: a.end_time,
    slotDuration: a.slot_duration ?? 30,
    count: 0,
  }));
}

export type AvailabilityInput = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotDuration: number;
};

/** Remplace l'ensemble des disponibilités hebdomadaires du médecin. */
export async function saveAvailability(
  doctorId: string,
  ranges: AvailabilityInput[],
): Promise<void> {
  if (useMock()) return; // mode mock : persistance locale côté écran (AsyncStorage)
  const { error: delErr } = await supabase!
    .from('doctor_availability')
    .delete()
    .eq('doctor_id', doctorId);
  if (delErr) throw delErr;
  if (ranges.length === 0) return;
  const rows = ranges.map((r) => ({
    doctor_id: doctorId,
    day_of_week: r.dayOfWeek,
    start_time: r.startTime,
    end_time: r.endTime,
    slot_duration: r.slotDuration,
    is_available: true,
  }));
  const { error } = await supabase!.from('doctor_availability').insert(rows);
  if (error) throw error;
}

/* ---------- Tarif (payment_fee_config) ---------- */
export async function getFeeConfig(): Promise<{ currentFee: number; platformFeeRate: number }> {
  if (useMock()) return mock.feeConfig;
  const { data } = await supabase!.from('payment_fee_config').select('*').limit(1).single();
  return {
    currentFee: mock.feeConfig.currentFee,
    platformFeeRate: (data?.platform_fee_percentage ?? 4) / 100,
  };
}
