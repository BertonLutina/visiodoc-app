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

/** Vrai si au moins deux plages du même jour se chevauchent (bornes adjacentes exclues). */
export function hasOverlappingRanges(ranges: { start: string; end: string }[]): boolean {
  const sorted = [...ranges].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  for (let i = 1; i < sorted.length; i++) {
    if (toMinutes(sorted[i].start) < toMinutes(sorted[i - 1].end)) return true;
  }
  return false;
}

export const minutesToTime = (mins: number): string => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export const toDateKey = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const dateFromKey = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Période affichable créneau par créneau : au-delà, la liste devient inutilisable. */
export const MAX_PERIOD_DAYS = 93;

export const PAUSE_DURATIONS = [15, 30, 45, 60, 90] as const;

export type Pause = { start: string; minutes: number };

export type DayRange = { start: string; end: string; pause: Pause | null };

/** Pause entièrement contenue dans la plage, bornes incluses. */
export function isPauseInside(range: { start: string; end: string }, pause: Pause): boolean {
  const start = toMinutes(range.start);
  const end = toMinutes(range.end);
  const pauseStart = toMinutes(pause.start);
  const pauseEnd = pauseStart + pause.minutes;
  return pause.minutes > 0 && pauseStart >= start && pauseEnd <= end && pauseStart < end;
}

/**
 * Découpe une plage autour de sa pause. Une pause absente ou invalide laisse la plage intacte.
 * Une pause qui couvre toute la plage ne laisse aucun segment.
 */
export function segmentsAfterPause(range: DayRange): { start: string; end: string }[] {
  if (!range.pause || !isPauseInside(range, range.pause)) {
    return [{ start: range.start, end: range.end }];
  }
  const start = toMinutes(range.start);
  const end = toMinutes(range.end);
  const pauseStart = toMinutes(range.pause.start);
  const pauseEnd = pauseStart + range.pause.minutes;
  const segments: { start: string; end: string }[] = [];
  if (pauseStart > start) segments.push({ start: range.start, end: minutesToTime(pauseStart) });
  if (pauseEnd < end) segments.push({ start: minutesToTime(pauseEnd), end: range.end });
  return segments;
}

/** Heures de pause possibles, au quart d'heure, strictement avant la fin de la plage. */
export function pauseTimeOptions(range: { start: string; end: string }): string[] {
  const start = toMinutes(range.start);
  const end = toMinutes(range.end);
  const out: string[] = [];
  for (let m = start; m < end; m += 15) out.push(minutesToTime(m));
  return out;
}

/** Pause proposée à l'ajout : 12:00 si ça tient, sinon un point médian calé sur 30 min. */
export function defaultPause(range: { start: string; end: string }): Pause | null {
  const start = toMinutes(range.start);
  const end = toMinutes(range.end);
  if (end - start < 15) return null;
  const durations = [60, 45, 30, 15];
  const noon = 12 * 60;
  if (noon >= start && noon < end) {
    for (const minutes of durations) {
      if (noon + minutes <= end) return { start: '12:00', minutes };
    }
  }
  const mid = start + Math.floor((end - start) / 2 / 30) * 30;
  for (const minutes of durations) {
    if (mid + minutes <= end) return { start: minutesToTime(mid), minutes };
  }
  for (const minutes of durations) {
    if (start + minutes <= end) return { start: minutesToTime(start), minutes };
  }
  return null;
}

export function eachDateKey(start: string, end: string): string[] {
  if (!start || !end || end < start) return [];
  const cur = dateFromKey(start);
  const last = dateFromKey(end);
  const out: string[] = [];
  while (cur <= last) {
    out.push(toDateKey(cur));
    cur.setDate(cur.getDate() + 1);
    if (out.length > 400) break;
  }
  return out;
}

export type PreviewSlot = { date: string; dayOfWeek: number; start: string; end: string };

/**
 * Créneaux de consultation sur toute la période, un par jour de semaine actif.
 * Même découpage que le moteur patient : durée du rendez-vous, pas de l'intervalle,
 * en sautant la pause de chaque plage.
 */
export function buildPeriodSlots(input: {
  periodStart: string;
  periodEnd: string;
  days: { enabled: boolean; ranges: DayRange[] }[];
  durationMinutes: number;
  intervalMinutes: number;
}): PreviewSlot[] {
  const dates = eachDateKey(input.periodStart, input.periodEnd);
  if (dates.length === 0 || dates.length > MAX_PERIOD_DAYS) return [];
  if (input.durationMinutes <= 0 || input.intervalMinutes <= 0) return [];

  const slots: PreviewSlot[] = [];
  for (const date of dates) {
    const day = dateFromKey(date);
    const dayOfWeek = jsDayToModel(day.getDay());
    const cfg = input.days[dayOfWeek];
    if (!cfg?.enabled) continue;
    for (const range of cfg.ranges) {
      for (const segment of segmentsAfterPause(range)) {
        const rangeStart = toMinutes(segment.start);
        const rangeEnd = toMinutes(segment.end);
        for (let m = rangeStart; m + input.durationMinutes <= rangeEnd; m += input.intervalMinutes) {
          slots.push({
            date,
            dayOfWeek,
            start: minutesToTime(m),
            end: minutesToTime(m + input.durationMinutes),
          });
        }
      }
    }
  }
  return slots;
}

export const slotKey = (date: string, start: string) => `${date}|${start}`;

export type SlotOverride = {
  date: string;
  isAvailable: boolean;
  ranges: { startTime: string; endTime: string }[];
};

/** Jours où le prestataire a retiré au moins un créneau. Les autres restent sur la règle hebdomadaire. */
export function overridesForRemovedSlots(slots: PreviewSlot[], excludedKeys: ReadonlySet<string>): SlotOverride[] {
  const byDate = new Map<string, PreviewSlot[]>();
  for (const slot of slots) {
    const list = byDate.get(slot.date) ?? [];
    list.push(slot);
    byDate.set(slot.date, list);
  }
  const overrides: SlotOverride[] = [];
  for (const [date, daySlots] of byDate) {
    if (!daySlots.some((s) => excludedKeys.has(slotKey(date, s.start)))) continue;
    const kept = daySlots.filter((s) => !excludedKeys.has(slotKey(date, s.start)));
    overrides.push({
      date,
      isAvailable: kept.length > 0,
      ranges: kept.map((s) => ({ startTime: s.start, endTime: s.end })),
    });
  }
  return overrides;
}
