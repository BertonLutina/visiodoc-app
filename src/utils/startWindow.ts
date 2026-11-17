import { translate } from '@/i18n/core';

/**
 * Fenêtre de démarrage d'un appel par le médecin (guide [MOB-1611-1]) : de `scheduled_at` (jamais avant) à
 * `scheduled_at` + 10 minutes. Passé ce délai le serveur annule la consultation (médecin absent) et rembourse
 * le patient en avoir. Constante alignée sur `PROVIDER_START_WINDOW_MINUTES` côté serveur.
 */
export const PROVIDER_START_WINDOW_MINUTES = 10;
const WINDOW_MS = PROVIDER_START_WINDOW_MINUTES * 60_000;

export type StartWindowState =
  | { phase: 'unknown' }
  /** Appel déjà lancé (`in_progress`) : on peut toujours le rejoindre, jamais coupé par la fenêtre. */
  | { phase: 'running' }
  | { phase: 'before'; msUntilStart: number }
  | { phase: 'open'; msLeft: number }
  | { phase: 'over' };

/**
 * @param scheduledAt ISO de `consultations.scheduled_at`
 * @param rawStatus statut brut de la consultation
 * @param nowMs instant courant, déjà corrigé du décalage d'horloge (`serverNowMs()`)
 */
export function providerStartWindow(
  scheduledAt: string | null | undefined,
  rawStatus: string | undefined,
  nowMs: number,
): StartWindowState {
  if (rawStatus === 'in_progress') return { phase: 'running' };
  const start = typeof scheduledAt === 'string' ? Date.parse(scheduledAt) : NaN;
  if (!Number.isFinite(start)) return { phase: 'unknown' };
  if (nowMs < start) return { phase: 'before', msUntilStart: start - nowMs };
  if (nowMs <= start + WINDOW_MS) return { phase: 'open', msLeft: start + WINDOW_MS - nowMs };
  return { phase: 'over' };
}

/** Durée restante au format `m:ss` (ou `h:mm:ss` au-delà d'une heure) ; jamais négative. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Le bouton « Démarrer » est actif : appel à rejoindre, fenêtre ouverte, ou heure inconnue (le serveur tranche). */
export function canStartNow(state: StartWindowState): boolean {
  return state.phase === 'running' || state.phase === 'open' || state.phase === 'unknown';
}

/** Message affiché sous le bouton « Démarrer » (médecin) ; `null` quand il n'y a rien à dire. */
export function startWindowMessage(state: StartWindowState): string | null {
  switch (state.phase) {
    case 'before':
      return translate("Démarrage possible à l'heure prévue, dans {time}", { time: formatCountdown(state.msUntilStart) });
    case 'open':
      return translate(
        "Lancez l'appel dans les {time} qui restent, sinon la consultation sera annulée (médecin absent).",
        { time: formatCountdown(state.msLeft) },
      );
    case 'over':
      return translate(
        'Délai de 10 minutes dépassé : la consultation va être annulée (médecin absent) et le patient remboursé en avoir.',
      );
    default:
      return null;
  }
}

/** Refus `42501` de la base : appel lancé hors de la fenêtre (ou par un autre utilisateur que le médecin). */
export function startDeniedMessage(): string {
  return translate("Vous ne pouvez lancer l'appel qu'à partir de l'heure prévue et pendant les 10 minutes qui suivent");
}

/** Le bandeau rouge « lancez l'appel » apparaît à partir de 60 minutes avant l'heure prévue. */
export const START_BANNER_LEAD_MS = 60 * 60_000;

/**
 * Bandeau rouge côté médecin avant la consultation suivante ([MOB-1611-1]) : il rappelle qu'un appel non lancé
 * dans les 10 minutes qui suivent l'heure prévue annule la consultation (médecin absent). Visible de 60 minutes
 * avant l'heure prévue jusqu'à la fin de la fenêtre ; `null` ensuite, ou si l'appel est déjà lancé.
 */
export function startReminderBanner(state: StartWindowState, scheduledAt: string | null | undefined): string | null {
  const show =
    state.phase === 'open' || (state.phase === 'before' && state.msUntilStart <= START_BANNER_LEAD_MS);
  if (!show) return null;
  const d = new Date(typeof scheduledAt === 'string' ? scheduledAt : NaN);
  const time = Number.isNaN(d.getTime())
    ? ''
    : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return translate(
    "Consultation à {time} : lancez l'appel dans les 10 minutes qui suivent l'heure prévue, sinon elle sera annulée (médecin absent) et le patient remboursé en avoir.",
    { time },
  );
}
