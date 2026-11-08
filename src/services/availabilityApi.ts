import { supabase, supabaseConfigured } from '@/lib/supabase';
import {
  DEFAULT_SETTINGS,
  computeDayStatus,
  dateKey,
  effectiveRangesForDate,
  generateSlots,
  type BookedRange,
  type DayStatus,
  type OverrideRule,
  type SchedulingSettings,
  type Slot,
  type WeeklyRule,
} from './availabilityEngine';

const useMock = () => !supabaseConfigured || !supabase;

/**
 * Qui lit les disponibilités : `signedIn` (même convention que patientApi). Sans session, aucune
 * lecture n'est faite : le backend n'expose plus `doctor_availability` ni `doctor_busy_slots` à
 * l'anonyme. Toutes les lectures passent par le client de SESSION, jamais `supabasePublic`.
 */
export type AvailabilityOptions = { signedIn?: boolean };

function monthBounds(year: number, month: number): { first: Date; last: Date } {
  return { first: new Date(year, month - 1, 1), last: new Date(year, month, 0) };
}

/** Vrai quand PostgREST ne connaît pas encore `valid_from` / `valid_to`. */
export function isMissingColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return /valid_from|valid_to/i.test(error.message ?? '');
}

let weeklyPeriodColumns: boolean | null = null;

function mapWeeklyRow(r: any, withWindow: boolean): WeeklyRule {
  return {
    dayOfWeek: r.day_of_week,
    startTime: String(r.start_time).slice(0, 5),
    endTime: String(r.end_time).slice(0, 5),
    ...(withWindow
      ? {
          validFrom: r.valid_from ? String(r.valid_from).slice(0, 10) : null,
          validTo: r.valid_to ? String(r.valid_to).slice(0, 10) : null,
        }
      : {}),
  };
}

async function fetchWeeklyRules(providerId: string): Promise<WeeklyRule[]> {
  const client = supabase;
  if (!client) return [];
  const query = (columns: string) =>
    client
      .from('doctor_availability')
      .select(columns)
      .eq('doctor_id', providerId)
      .eq('recurrence_type', 'weekly')
      .eq('is_available', true);

  if (weeklyPeriodColumns !== false) {
    const first = await query('day_of_week, start_time, end_time, valid_from, valid_to');
    if (!first.error) {
      weeklyPeriodColumns = true;
      return (first.data ?? []).map((r: any) => mapWeeklyRow(r, true));
    }
    if (!isMissingColumnError(first.error)) throw first.error;
    weeklyPeriodColumns = false;
  }

  const { data, error } = await query('day_of_week, start_time, end_time');
  if (error) throw error;
  return (data ?? []).map((r: any) => mapWeeklyRow(r, false));
}

async function fetchOverrides(providerId: string, from: Date, to: Date): Promise<OverrideRule[]> {
  const client = supabase;
  if (!client) return [];
  const { data, error } = await client
    .from('doctor_availability')
    .select('specific_date, start_time, end_time, is_available')
    .eq('doctor_id', providerId)
    .eq('recurrence_type', 'specific_date')
    .gte('specific_date', dateKey(from))
    .lte('specific_date', dateKey(to));
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    date: r.specific_date,
    isAvailable: r.is_available,
    startTime: r.start_time ? String(r.start_time).slice(0, 5) : undefined,
    endTime: r.end_time ? String(r.end_time).slice(0, 5) : undefined,
  }));
}

export async function getSchedulingSettings(providerId: string): Promise<SchedulingSettings> {
  if (useMock()) return DEFAULT_SETTINGS;
  const { data, error } = await supabase!
    .from('provider_scheduling_settings')
    .select('*')
    .eq('provider_id', providerId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_SETTINGS;
  return {
    appointmentDurationMinutes: data.appointment_duration_minutes,
    slotIntervalMinutes: data.slot_interval_minutes,
    bufferBeforeMinutes: data.buffer_before_minutes,
    bufferAfterMinutes: data.buffer_after_minutes,
    minimumNoticeMinutes: data.minimum_notice_minutes,
    bookingHorizonDays: data.booking_horizon_days,
  };
}

export async function saveSchedulingSettings(
  providerId: string,
  settings: SchedulingSettings,
): Promise<void> {
  if (useMock()) return;
  const { error } = await supabase!.from('provider_scheduling_settings').upsert({
    provider_id: providerId,
    appointment_duration_minutes: settings.appointmentDurationMinutes,
    slot_interval_minutes: settings.slotIntervalMinutes,
    buffer_before_minutes: settings.bufferBeforeMinutes,
    buffer_after_minutes: settings.bufferAfterMinutes,
    minimum_notice_minutes: settings.minimumNoticeMinutes,
    booking_horizon_days: settings.bookingHorizonDays,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

/** La RPC refuse `p_to - p_from > 62 jours` (SQLSTATE 22023) : 62 jours exactement passent. */
const MAX_BUSY_WINDOW_MS = 62 * 24 * 60 * 60 * 1000;

/**
 * Créneaux occupés d'un médecin sur [from, to) via la RPC `doctor_busy_slots` (session obligatoire).
 * Les plages > 62 jours sont découpées en fenêtres contiguës de 62 jours max (sans trou ni chevauchement).
 * Sans session : aucun appel, liste vide. 42501 (non connecté) = « aucun créneau » ; toute autre
 * erreur est propagée (comme avant avec la vue).
 */
export async function fetchBookedRanges(
  providerId: string,
  from: Date,
  to: Date,
  options: AvailabilityOptions = {},
): Promise<BookedRange[]> {
  if (!options.signedIn || useMock()) return [];
  const end = to.getTime();
  const ranges: BookedRange[] = [];
  for (let start = from.getTime(); start < end; start += MAX_BUSY_WINDOW_MS) {
    const windowEnd = Math.min(start + MAX_BUSY_WINDOW_MS, end);
    const { data, error } = await supabase!.rpc('doctor_busy_slots', {
      p_doctor_id: providerId,
      p_from: new Date(start).toISOString(),
      p_to: new Date(windowEnd).toISOString(),
    });
    if (error) {
      if (error.code === '42501') return [];
      throw error;
    }
    for (const r of (data ?? []) as { scheduled_at: string; duration: number | null }[]) {
      const slotStart = new Date(r.scheduled_at);
      ranges.push({ start: slotStart, end: new Date(slotStart.getTime() + (r.duration ?? 30) * 60000) });
    }
  }
  return ranges;
}

/**
 * Pure : construit le statut jour-par-jour du mois à partir des données déjà chargées.
 * Séparée de getMonthAvailability pour rester testable sans Supabase.
 */
export function buildMonthAvailability(
  year: number,
  month: number,
  weeklyRules: WeeklyRule[],
  overrides: OverrideRule[],
  settings: SchedulingSettings,
  bookedRanges: BookedRange[],
  now: Date,
): Record<string, DayStatus> {
  const { first, last } = monthBounds(year, month);
  const result: Record<string, DayStatus> = {};
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
    const date = new Date(d);
    const ranges = effectiveRangesForDate(date, weeklyRules, overrides);
    const slots = generateSlots(date, ranges, settings, bookedRanges, now);
    result[dateKey(date)] = computeDayStatus(slots);
  }
  return result;
}

export async function getMonthAvailability(
  providerId: string,
  year: number,
  month: number,
  options: AvailabilityOptions = {},
): Promise<Record<string, DayStatus>> {
  if (!options.signedIn) return {}; // visiteur : ni créneaux ni requête
  const { first, last } = monthBounds(year, month);
  const rangeEnd = new Date(last);
  rangeEnd.setDate(rangeEnd.getDate() + 1);

  const [weeklyRules, overrides, settings, bookedRanges] = await Promise.all([
    fetchWeeklyRules(providerId),
    fetchOverrides(providerId, first, last),
    getSchedulingSettings(providerId),
    fetchBookedRanges(providerId, first, rangeEnd, options),
  ]);

  return buildMonthAvailability(year, month, weeklyRules, overrides, settings, bookedRanges, new Date());
}

export async function getDaySlots(
  providerId: string,
  date: Date,
  options: AvailabilityOptions = {},
): Promise<Slot[]> {
  if (!options.signedIn) return []; // visiteur : ni créneaux ni requête
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const [weeklyRules, overrides, settings, bookedRanges] = await Promise.all([
    fetchWeeklyRules(providerId),
    fetchOverrides(providerId, dayStart, dayStart),
    getSchedulingSettings(providerId),
    fetchBookedRanges(providerId, dayStart, dayEnd, options),
  ]);

  const ranges = effectiveRangesForDate(dayStart, weeklyRules, overrides);
  return generateSlots(dayStart, ranges, settings, bookedRanges, new Date());
}
