import { supabase, supabasePublic, supabaseConfigured } from '@/lib/supabase';
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
const readClient = () => supabasePublic ?? supabase;

function monthBounds(year: number, month: number): { first: Date; last: Date } {
  return { first: new Date(year, month - 1, 1), last: new Date(year, month, 0) };
}

async function fetchWeeklyRules(providerId: string): Promise<WeeklyRule[]> {
  const client = readClient();
  if (!client) return [];
  const { data, error } = await client
    .from('doctor_availability')
    .select('day_of_week, start_time, end_time')
    .eq('doctor_id', providerId)
    .eq('recurrence_type', 'weekly')
    .eq('is_available', true);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    dayOfWeek: r.day_of_week,
    startTime: String(r.start_time).slice(0, 5),
    endTime: String(r.end_time).slice(0, 5),
  }));
}

async function fetchOverrides(providerId: string, from: Date, to: Date): Promise<OverrideRule[]> {
  const client = readClient();
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

async function fetchBookedRanges(providerId: string, from: Date, to: Date): Promise<BookedRange[]> {
  const client = readClient();
  if (!client) return [];
  const { data, error } = await client
    .from('consultation_busy_times')
    .select('scheduled_at, duration')
    .eq('doctor_id', providerId)
    .gte('scheduled_at', from.toISOString())
    .lt('scheduled_at', to.toISOString());
  if (error) throw error;
  return (data ?? []).map((r: any) => {
    const start = new Date(r.scheduled_at);
    return { start, end: new Date(start.getTime() + (r.duration ?? 30) * 60000) };
  });
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
): Promise<Record<string, DayStatus>> {
  const { first, last } = monthBounds(year, month);
  const rangeEnd = new Date(last);
  rangeEnd.setDate(rangeEnd.getDate() + 1);

  const [weeklyRules, overrides, settings, bookedRanges] = await Promise.all([
    fetchWeeklyRules(providerId),
    fetchOverrides(providerId, first, last),
    getSchedulingSettings(providerId),
    fetchBookedRanges(providerId, first, rangeEnd),
  ]);

  return buildMonthAvailability(year, month, weeklyRules, overrides, settings, bookedRanges, new Date());
}

export async function getDaySlots(providerId: string, date: Date): Promise<Slot[]> {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const [weeklyRules, overrides, settings, bookedRanges] = await Promise.all([
    fetchWeeklyRules(providerId),
    fetchOverrides(providerId, dayStart, dayStart),
    getSchedulingSettings(providerId),
    fetchBookedRanges(providerId, dayStart, dayEnd),
  ]);

  const ranges = effectiveRangesForDate(dayStart, weeklyRules, overrides);
  return generateSlots(dayStart, ranges, settings, bookedRanges, new Date());
}
