import { eachDateKey } from './availability';

/** Plus longue période d'indisponibilité enregistrable d'un coup (1 an). */
export const MAX_EXCEPTION_DAYS = 366;

type OverrideLike = {
  date: string;
  isAvailable: boolean;
  ranges: { startTime: string; endTime: string }[];
  reason?: string | null;
};

export type ExceptionEntry = {
  /** 'unavailable' : congé / indisponibilité ; 'custom' : horaires différents ce jour-là. */
  kind: 'unavailable' | 'custom';
  start: string;
  end: string;
  dates: string[];
  reason: string | null;
  ranges: { startTime: string; endTime: string }[];
};

const nextDay = (key: string): string => {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/**
 * Pure : transforme les overrides (un par date) en entrées affichables. Les jours
 * indisponibles consécutifs qui ont la même raison sont fusionnés en une période
 * (« Vacances du 12 au 20 »), comme dans la version web.
 */
export function groupExceptions(overrides: OverrideLike[]): ExceptionEntry[] {
  const sorted = [...overrides].sort((a, b) => a.date.localeCompare(b.date));
  const out: ExceptionEntry[] = [];
  for (const o of sorted) {
    const reason = o.reason?.trim() ? o.reason.trim() : null;
    if (o.isAvailable) {
      out.push({ kind: 'custom', start: o.date, end: o.date, dates: [o.date], reason: null, ranges: o.ranges });
      continue;
    }
    const last = out[out.length - 1];
    if (last && last.kind === 'unavailable' && last.reason === reason && nextDay(last.end) === o.date) {
      last.end = o.date;
      last.dates.push(o.date);
    } else {
      out.push({ kind: 'unavailable', start: o.date, end: o.date, dates: [o.date], reason, ranges: [] });
    }
  }
  return out;
}

/** Toutes les dates d'une période (bornes incluses) ; vide si invalide ou trop longue. */
export function periodDates(start: string, end: string): string[] {
  const dates = eachDateKey(start, end);
  return dates.length > MAX_EXCEPTION_DAYS ? [] : dates;
}
