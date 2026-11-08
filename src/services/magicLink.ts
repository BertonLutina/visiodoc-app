import { translate } from '@/i18n/core';
import { supabase } from '@/lib/supabase';
import { authErrorMessage, readHttpError } from '@/utils/authError';
import { resendCooldownRemaining } from '@/services/registration';

/**
 * Lien magique patient, identique au web :
 *   POST /functions/v1/magic-link-request  { email }   → e-mail avec `<FRONTEND>/auth/verify?token=<64 hex>`
 *   POST /functions/v1/magic-link-verify   { token }   → { success, session: { access_token, refresh_token }, user }
 * Réservé aux patients (le serveur refuse les autres rôles). Le jeton est à usage unique, 15 min.
 */

export type MagicLinkErrorKind = 'rate_limited' | 'invalid_link' | 'forbidden' | 'unknown';

export class MagicLinkError extends Error {
  kind: MagicLinkErrorKind;
  /** Texte renvoyé par le serveur (français), utilisé seulement pour un refus 403 explicite. */
  serverMessage?: string;

  constructor(kind: MagicLinkErrorKind, message: string, serverMessage?: string) {
    super(message);
    this.name = 'MagicLinkError';
    this.kind = kind;
    this.serverMessage = serverMessage;
  }
}

const TOKEN_PATTERN = /^[0-9a-f]{64}$/i;

/** Jeton du lien : 64 caractères hexadécimaux, sinon `null` (jamais d'appel serveur pour une valeur douteuse). */
export function parseMagicLinkToken(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const token = value.trim();
  return TOKEN_PATTERN.test(token) ? token : null;
}

function kindForStatus(status: number | undefined): MagicLinkErrorKind {
  if (status === 429) return 'rate_limited';
  if (status === 400 || status === 401 || status === 404) return 'invalid_link';
  if (status === 403) return 'forbidden';
  return 'unknown';
}

async function toMagicLinkError(error: any): Promise<MagicLinkError> {
  const { status, body } = await readHttpError(error);
  const serverMessage = typeof body?.error === 'string' ? body.error : undefined;
  return new MagicLinkError(kindForStatus(status), serverMessage ?? error?.message ?? '', serverMessage);
}

/** Message affiché à l'écran, toujours passé par `translate`. */
export function magicLinkErrorMessage(error: unknown): string {
  if (error instanceof MagicLinkError) {
    switch (error.kind) {
      case 'rate_limited':
        return translate('Patiente 60 secondes avant de demander un nouveau lien.');
      case 'invalid_link':
        return translate('Ce lien est invalide, expiré ou déjà utilisé. Demande-en un nouveau.');
      case 'forbidden':
        return error.serverMessage ?? translate("Ce type de connexion n'est pas disponible pour ce compte.");
      default:
        break;
    }
  }
  return authErrorMessage(error);
}

/* ---------- Temporisation de 60 s entre deux envois (même règle que le serveur), par adresse ---------- */

const lastLinkSentAt = new Map<string, number>();
const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function markMagicLinkSent(email: string, now: number = Date.now()): void {
  const key = normalizeEmail(email);
  if (!key) return;
  lastLinkSentAt.set(key, now);
  for (const [k, at] of lastLinkSentAt) {
    if (resendCooldownRemaining(at, now) === 0) lastLinkSentAt.delete(k);
  }
}

/** Secondes avant de pouvoir redemander un lien pour cette adresse (0 = possible). */
export function magicLinkCooldownRemaining(email: string, now: number = Date.now()): number {
  const key = normalizeEmail(email);
  if (!key) return 0;
  return resendCooldownRemaining(lastLinkSentAt.get(key) ?? null, now);
}

/** Réservé aux tests. */
export function resetMagicLinkCooldowns(): void {
  lastLinkSentAt.clear();
}

/**
 * Demande l'e-mail de connexion. Le serveur répond 200 sans rien révéler quand l'adresse est inconnue
 * ou n'est pas celle d'un patient : l'écran affiche donc toujours le même message neutre.
 */
export async function requestMagicLink(email: string): Promise<void> {
  if (!supabase) return;
  const clean = normalizeEmail(email);
  const { data, error } = await supabase.functions.invoke('magic-link-request', { body: { email: clean } });
  if (error) throw await toMagicLinkError(error);
  if (typeof data?.error === 'string') {
    throw new MagicLinkError('unknown', data.error, data.error);
  }
  markMagicLinkSent(clean);
}

export interface MagicLinkSession {
  access_token: string;
  refresh_token: string;
}

/** Échange le jeton du lien contre une session (à ouvrir avec `supabase.auth.setSession`). */
export async function verifyMagicLinkToken(token: string): Promise<MagicLinkSession> {
  if (!supabase) throw new MagicLinkError('unknown', translate('Une erreur est survenue. Réessaie.'));
  const parsed = parseMagicLinkToken(token);
  if (!parsed) throw new MagicLinkError('invalid_link', 'invalid token');
  const { data, error } = await supabase.functions.invoke('magic-link-verify', { body: { token: parsed } });
  if (error) throw await toMagicLinkError(error);
  if (typeof data?.error === 'string') {
    throw new MagicLinkError('unknown', data.error, data.error);
  }
  const session = data?.session;
  if (typeof session?.access_token !== 'string' || typeof session?.refresh_token !== 'string') {
    throw new MagicLinkError('unknown', translate('Une erreur est survenue. Réessaie.'));
  }
  return { access_token: session.access_token, refresh_token: session.refresh_token };
}
