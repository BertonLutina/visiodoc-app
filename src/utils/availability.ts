import type { AvailabilitySlot } from '@/types/provider';

// Modèle de jour : 0 = Lundi … 6 = Dimanche
export const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
export const DAY_LABELS_LONG = [
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
  'Dimanche',
];

/** JS Date.getDay() : 0=Dim … 6=Sam → notre modèle 0=Lun … 6=Dim */
export const jsDayToModel = (d: number) => (d + 6) % 7;

/** Créneaux horaires proposés dans le sélecteur (06:00 → 22:00, pas de 30 min). */
export const TIME_OPTIONS: string[] = (() => {
  const out: string[] = [];
  for (let h = 6; h <= 22; h++) {
    for (const m of [0, 30]) out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
  return out;
})();

export const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
export const fromMinutes = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Nombre de créneaux dans une plage [start, end] pour une durée donnée. */
export const countSlots = (start: string, end: string, dur: number) =>
  Math.max(0, Math.floor((toMinutes(end) - toMinutes(start)) / dur));

export type DaySlots = {
  /** Clé ISO (YYYY-MM-DD) */
  key: string;
  date: Date;
  /** "Lun 30" */
  label: string;
  weekdayLong: string;
  /** Heures réservables, ex: ["09:00","09:30",…] */
  times: string[];
};

/**
 * À partir des disponibilités hebdomadaires d'un médecin, génère les jours
 * réservables (avec leurs créneaux) sur les `daysAhead` prochains jours.
 * Les créneaux passés du jour même sont exclus.
 */
export function generateBookableDays(
  availability: AvailabilitySlot[],
  daysAhead = 14,
): DaySlots[] {
  const byDay = new Map<number, AvailabilitySlot[]>();
  for (const a of availability) {
    const arr = byDay.get(a.dayOfWeek) ?? [];
    arr.push(a);
    byDay.set(a.dayOfWeek, arr);
  }

  const result: DaySlots[] = [];
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  for (let i = 0; i < daysAhead; i++) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + i);
    const model = jsDayToModel(date.getDay());
    const ranges = byDay.get(model);
    if (!ranges?.length) continue;

    const times: string[] = [];
    for (const r of ranges) {
      const dur = r.slotDuration || 30;
      for (let m = toMinutes(r.startTime); m + dur <= toMinutes(r.endTime); m += dur) {
        if (i === 0 && m <= nowMin) continue; // pas de créneau passé aujourd'hui
        times.push(fromMinutes(m));
      }
    }
    if (!times.length) continue;

    result.push({
      key: date.toISOString().slice(0, 10),
      date,
      label: `${DAY_LABELS[model]} ${date.getDate()}`,
      weekdayLong: DAY_LABELS_LONG[model],
      times: [...new Set(times)].sort(),
    });
  }
  return result;
}
