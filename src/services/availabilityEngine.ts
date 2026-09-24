/**
 * Moteur de disponibilité — logique pure (aucun accès réseau/Supabase ici).
 * Convention de jour identique à src/utils/availability.ts : 0=Lundi … 6=Dimanche.
 */

export type WeeklyRule = { dayOfWeek: number; startTime: string; endTime: string };

export type OverrideRule = {
  date: string; // 'YYYY-MM-DD'
  isAvailable: boolean;
  startTime?: string;
  endTime?: string;
};

export type TimeRange = { startTime: string; endTime: string };

export type SchedulingSettings = {
  appointmentDurationMinutes: number;
  slotIntervalMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minimumNoticeMinutes: number;
  bookingHorizonDays: number;
};

export const DEFAULT_SETTINGS: SchedulingSettings = {
  appointmentDurationMinutes: 30,
  slotIntervalMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minimumNoticeMinutes: 120,
  bookingHorizonDays: 60,
};

export type BookedRange = { start: Date; end: Date };
export type Slot = { start: Date; end: Date; available: boolean };
export type DayStatus = 'available' | 'full' | 'unavailable';

const toMinutes = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

export const dateKey = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** JS Date.getDay() : 0=Dim … 6=Sam -> modèle 0=Lun … 6=Dim */
const jsDayToModel = (d: number) => (d + 6) % 7;

/**
 * Plages horaires effectives pour une date donnée : un override pour cette date
 * remplace ENTIÈREMENT la règle hebdomadaire (qu'il s'agisse d'horaires personnalisés
 * ou d'une indisponibilité totale).
 */
export function effectiveRangesForDate(
  date: Date,
  weeklyRules: WeeklyRule[],
  overrides: OverrideRule[],
): TimeRange[] {
  const key = dateKey(date);
  const dayOverrides = overrides.filter((o) => o.date === key);
  if (dayOverrides.length > 0) {
    return dayOverrides
      .filter((o) => o.isAvailable && o.startTime && o.endTime)
      .map((o) => ({ startTime: o.startTime as string, endTime: o.endTime as string }));
  }
  const model = jsDayToModel(date.getDay());
  return weeklyRules
    .filter((r) => r.dayOfWeek === model)
    .map((r) => ({ startTime: r.startTime, endTime: r.endTime }));
}

/**
 * Créneaux réservables pour une date donnée, à partir des plages effectives, des réglages
 * de réservation et des rendez-vous déjà pris. `now` est injecté (jamais `new Date()` en
 * interne) pour que la fonction reste pure et testable.
 */
export function generateSlots(
  date: Date,
  ranges: TimeRange[],
  settings: SchedulingSettings,
  bookedRanges: BookedRange[],
  now: Date,
): Slot[] {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  if (dayStart < todayStart) return [];

  const horizonEnd = new Date(todayStart);
  horizonEnd.setDate(horizonEnd.getDate() + settings.bookingHorizonDays);
  if (dayStart > horizonEnd) return [];

  const minStart = new Date(now.getTime() + settings.minimumNoticeMinutes * 60000);

  const slots: Slot[] = [];
  for (const range of ranges) {
    const rangeStartMin = toMinutes(range.startTime);
    const rangeEndMin = toMinutes(range.endTime);
    for (
      let m = rangeStartMin;
      m + settings.appointmentDurationMinutes <= rangeEndMin;
      m += settings.slotIntervalMinutes
    ) {
      const start = new Date(dayStart);
      start.setMinutes(m);
      const end = new Date(start.getTime() + settings.appointmentDurationMinutes * 60000);

      if (start < minStart) continue;

      const bufferedStart = new Date(start.getTime() - settings.bufferBeforeMinutes * 60000);
      const bufferedEnd = new Date(end.getTime() + settings.bufferAfterMinutes * 60000);
      const conflicts = bookedRanges.some((b) => bufferedStart < b.end && bufferedEnd > b.start);

      slots.push({ start, end, available: !conflicts });
    }
  }
  return slots.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** 'available' si au moins un créneau libre, 'full' si tout est pris, 'unavailable' si aucun créneau. */
export function computeDayStatus(slots: Slot[]): DayStatus {
  if (slots.length === 0) return 'unavailable';
  return slots.some((s) => s.available) ? 'available' : 'full';
}
