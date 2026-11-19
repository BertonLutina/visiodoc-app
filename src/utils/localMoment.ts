import { appLocale, translate } from '@/i18n/core';

/**
 * Mises en forme d'un instant en HEURE LOCALE de l'appareil (jamais UTC : le serveur renvoie des ISO en UTC).
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** `12h42` (24 h, heure locale). */
export function localTimeLabel(d: Date): string {
  return `${d.getHours()}h${pad(d.getMinutes())}`;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * « aujourd'hui à 12h42 », « demain à 12h42 », sinon « dimanche 22/11 à 12h42 » (heure et jour locaux).
 * `null` si la date est absente ou invalide.
 */
export function localDayTimeLabel(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (typeof iso !== 'string' || !iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const time = localTimeLabel(d);
  const dayDiff = Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000);
  if (dayDiff === 0) return translate("aujourd'hui à {time}", { time });
  if (dayDiff === 1) return translate('demain à {time}', { time });
  return translate('{day} {date} à {time}', {
    day: d.toLocaleDateString(appLocale(), { weekday: 'long' }),
    date: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`,
    time,
  });
}
