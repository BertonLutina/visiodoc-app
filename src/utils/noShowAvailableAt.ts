/** Attente minimale avant de pouvoir déclarer le patient absent (trigger serveur `enforce_noshow_min_wait`). */
export const NO_SHOW_WAIT_MS = 15 * 60 * 1000;

const toMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const n = new Date(iso).getTime();
  return Number.isNaN(n) ? null : n;
};

/**
 * Instant à partir duquel « patient absent » est accepté par le serveur : si `started_at` est renseigné,
 * GREATEST(scheduled_at, started_at + 15 min) ; sinon scheduled_at + 15 min. `null` si l'heure du RDV est inconnue.
 */
export function noShowAvailableAt(scheduledAt: string | null | undefined, startedAt: string | null | undefined): Date | null {
  const s = toMs(scheduledAt);
  if (s === null) return null;
  const st = toMs(startedAt);
  const t = st === null ? s + NO_SHOW_WAIT_MS : Math.max(s, st + NO_SHOW_WAIT_MS);
  return new Date(t);
}

export type NoShowButtonState =
  | { enabled: true }
  | { enabled: false; reason: 'wait'; minutes: number }
  | { enabled: false; reason: 'joined' };

/**
 * État du bouton « Le patient est absent ». `patientJoinedAt` (optionnel, pas encore fourni par le backend) :
 * s'il est non nul, le patient a rejoint, le bouton reste désactivé. Heure inconnue : actif, le serveur tranche.
 */
export function noShowButtonState(input: {
  availableAt: Date | null;
  now: number;
  patientJoinedAt?: string | null;
}): NoShowButtonState {
  if (input.patientJoinedAt) return { enabled: false, reason: 'joined' };
  if (!input.availableAt) return { enabled: true };
  const left = input.availableAt.getTime() - input.now;
  if (left <= 0) return { enabled: true };
  return { enabled: false, reason: 'wait', minutes: Math.ceil(left / 60000) };
}
