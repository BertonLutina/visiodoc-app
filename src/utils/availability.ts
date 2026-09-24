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
