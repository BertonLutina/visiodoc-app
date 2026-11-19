/**
 * Prochaine consultation du prestataire et état du bouton d'entrée dans l'appel, comme le web.
 * Règle web (supabase/functions/_shared/videoRoomAccess.ts, ROOM_OPENS_BEFORE_MINUTES = 0) : la salle ouvre à
 * l'heure prévue exacte ; le prestataire a ensuite 15 min pour démarrer (PROVIDER_START_WINDOW_MINUTES), sinon il
 * est déclaré absent. Le serveur (get-video-token) reste juge : son refus « trop tôt » est le filet.
 */
export const JOIN_LEAD_MINUTES = 0;
export const START_WINDOW_MINUTES = 15;

const MIN = 60_000;

export interface NextCandidate {
  id: string;
  rawStatus?: string;
  scheduledAt?: string;
}

const ms = (iso: string | undefined): number => (iso ? new Date(iso).getTime() : NaN);

/**
 * La consultation en cours, sinon la plus proche à venir (scheduled). Une consultation planifiée dont la fenêtre de
 * démarrage de 15 min est dépassée est ignorée (le prestataire sera déclaré absent). Une seule consultation, ou null.
 */
export function pickNextConsultation<T extends NextCandidate>(list: T[], now: number): T | null {
  const inProgress = list.filter((c) => c.rawStatus === 'in_progress');
  if (inProgress.length > 0) {
    return [...inProgress].sort((a, b) => ms(a.scheduledAt) - ms(b.scheduledAt))[0];
  }
  const upcoming = list
    .filter((c) => c.rawStatus === 'scheduled' && !Number.isNaN(ms(c.scheduledAt)))
    .filter((c) => now <= ms(c.scheduledAt) + START_WINDOW_MINUTES * MIN)
    .sort((a, b) => ms(a.scheduledAt) - ms(b.scheduledAt));
  return upcoming[0] ?? null;
}

export type JoinButtonState = { enabled: true } | { enabled: false; opensAt: number };

/** Actif dès `scheduled_at - JOIN_LEAD_MINUTES`, ou si l'appel est déjà en cours. Heure inconnue : actif (le serveur tranche). */
export function joinButtonState(
  c: { rawStatus?: string; scheduledAt?: string },
  now: number,
  leadMinutes: number = JOIN_LEAD_MINUTES,
): JoinButtonState {
  if (c.rawStatus === 'in_progress') return { enabled: true };
  const s = ms(c.scheduledAt);
  if (Number.isNaN(s)) return { enabled: true };
  const opensAt = s - leadMinutes * MIN;
  return now >= opensAt ? { enabled: true } : { enabled: false, opensAt };
}

/** Heure locale HH:MM. */
export function clockTime(value: number | string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** « Le patient est absent » disparaît dès que le patient a rejoint (`patient_joined_at` non nul). */
export function showAbsentChoice(patientJoinedAt: string | null | undefined): boolean {
  return !patientJoinedAt;
}
