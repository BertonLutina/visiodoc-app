import { translate } from '@/i18n/core';
import { isSessionExpiry } from '@/services/sessionExpiry';

/** Refus de connexion d'un prestataire dont la garde (`providerGate`) ne donne pas d'accès. */
export type ProviderRefusal = 'pending' | 'rejected' | 'incomplete' | 'suspended';

const PROVIDER_REFUSAL_CODES: Record<ProviderRefusal, string> = {
  pending: 'PROVIDER_PENDING',
  rejected: 'PROVIDER_REJECTED',
  incomplete: 'PROVIDER_INCOMPLETE',
  suspended: 'PROVIDER_SUSPENDED',
};

/** Un message par statut, toujours passés par `translate`. */
export const PROVIDER_PENDING_MESSAGE = 'Ton compte est en attente de validation par notre équipe.';
export const PROVIDER_REJECTED_MESSAGE = 'Ton profil a été refusé. Contacte le support pour en savoir plus.';
export const PROVIDER_INCOMPLETE_MESSAGE = 'Ton profil est incomplet. Finalise ton dossier pour continuer.';
export const PROVIDER_SUSPENDED_MESSAGE = 'Ton compte est suspendu. Contacte le support.';

const PROVIDER_REFUSAL_MESSAGES: Record<ProviderRefusal, string> = {
  pending: PROVIDER_PENDING_MESSAGE,
  rejected: PROVIDER_REJECTED_MESSAGE,
  incomplete: PROVIDER_INCOMPLETE_MESSAGE,
  suspended: PROVIDER_SUSPENDED_MESSAGE,
};

export function providerRefusalError(reason: ProviderRefusal): Error {
  return new Error(PROVIDER_REFUSAL_CODES[reason]);
}

/** Motif du refus si l'erreur en est un, sinon `null`. */
export function providerRefusal(e: any): ProviderRefusal | null {
  const message = e?.message;
  const found = (Object.keys(PROVIDER_REFUSAL_CODES) as ProviderRefusal[]).find(
    (reason) => PROVIDER_REFUSAL_CODES[reason] === message,
  );
  return found ?? null;
}

export function providerRefusalMessage(reason: ProviderRefusal): string {
  return translate(PROVIDER_REFUSAL_MESSAGES[reason]);
}

/** Code d'erreur : rôle (admin, validateur…) non autorisé sur l'application mobile. */
export const ROLE_NOT_ALLOWED = 'ROLE_NOT_ALLOWED';

export function roleNotAllowedError(): Error {
  return new Error(ROLE_NOT_ALLOWED);
}

export function isRoleNotAllowed(e: any): boolean {
  return e?.message === ROLE_NOT_ALLOWED;
}

/** Texte exact du guide (0.3), point final compris. */
export function roleNotAllowedMessage(): string {
  return translate("Vous n'êtes pas autorisé ici, utilisez la version web.");
}

/**
 * Refus HTTP 422 `weak_password` pour cause de mot de passe compromis (HIBP) : le texte du guide,
 * sinon `null`. Corps GoTrue : `{ error_code: 'weak_password', reasons: ['pwned'] }` ; quand seul
 * le message est disponible (Edge Function, FunctionsHttpError), on cherche `weak_password` / `pwned`.
 */
export function pwnedPasswordMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as Record<string, unknown>;
  const reasons = Array.isArray(e.reasons) ? e.reasons.map(String) : null;
  const text = [e.message, e.msg, e.error, e.error_code, e.code, ...(reasons ?? [])]
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .toLowerCase();
  // Corps structuré : weak_password pour une autre raison (longueur…) n'est pas un mot de passe fuité.
  if (reasons && reasons.length > 0 && !reasons.includes('pwned')) return null;
  const pwned =
    text.includes('weak_password') || text.includes('pwned') || text.includes('known to be weak and easy to guess');
  return pwned ? translate('Ce mot de passe a déjà fuité sur Internet, choisis-en un autre.') : null;
}

/**
 * Erreur levée pour une réponse d'Edge Function en échec. Conserve `error_code` et `reasons` du
 * corps (sinon `new Error(body.error)` les perdrait et `pwnedPasswordMessage` ne reconnaîtrait pas
 * le refus `weak_password` / `pwned`).
 */
export function edgeFunctionError(
  body: { error?: unknown; error_code?: unknown; reasons?: unknown } | null | undefined,
  fallbackMessage = '',
): Error & { error_code?: string; reasons?: string[] } {
  // Jamais de message vide : corps sans `error` texte → message de repli, sinon message générique.
  const message =
    (typeof body?.error === 'string' && body.error) ||
    fallbackMessage ||
    translate('Une erreur est survenue. Réessaie.');
  const err: Error & { error_code?: string; reasons?: string[] } = new Error(message);
  if (typeof body?.error_code === 'string') err.error_code = body.error_code;
  if (Array.isArray(body?.reasons)) err.reasons = body.reasons.map(String);
  return err;
}

/** Statut HTTP + corps JSON d'une `FunctionsHttpError` (la `Response` est dans `error.context`). */
export async function readHttpError(error: any): Promise<{ status: number | undefined; body: any }> {
  const response = error?.context;
  const status: number | undefined = typeof response?.status === 'number' ? response.status : undefined;
  let body: any = null;
  try {
    body = await response?.json?.();
  } catch {
    /* corps absent ou illisible */
  }
  return { status, body };
}

/**
 * Erreur GoTrue `email_not_confirmed` (« Email not confirmed ») : connexion par mot de passe d'un
 * compte dont l'adresse n'a pas encore été confirmée (confirmation obligatoire, guide MOB-0612-1).
 */
export function isEmailNotConfirmed(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as Record<string, unknown>;
  if (e.code === 'email_not_confirmed' || e.error_code === 'email_not_confirmed') return true;
  return typeof e.message === 'string' && e.message.toLowerCase().includes('email not confirmed');
}

/** Traduit une erreur Supabase Auth/Postgres en message lisible (FR). */
export function authErrorMessage(e: any): string {
  const msg = (e?.message ?? '').toString();
  const lower = msg.toLowerCase();
  if (msg === ROLE_NOT_ALLOWED) return roleNotAllowedMessage();
  const refusal = providerRefusal(e);
  if (refusal) return providerRefusalMessage(refusal);
  const pwned = pwnedPasswordMessage(e);
  if (pwned) return pwned;
  if (isSessionExpiry(e)) return translate('Ta session a expiré, reconnecte-toi.');
  if (lower.includes('invalid login credentials')) return translate('Email ou mot de passe incorrect.');
  if (
    lower.includes('already registered') ||
    lower.includes('already been registered') ||
    e?.code === '23505'
  )
    return translate('Un compte existe déjà avec cet email.');
  if (lower.includes('password should be at least'))
    return translate('Le mot de passe doit comporter au moins 10 caractères et inclure au moins une lettre et un chiffre.');
  if (lower.includes('invalid email') || lower.includes('unable to validate email'))
    return translate('Adresse email invalide.');
  if (isEmailNotConfirmed(e))
    return translate("Ton adresse e-mail n'est pas encore confirmée. Clique sur le lien reçu par e-mail.");
  // Codes / SMS sans mot de passe
  if (lower.includes('otp_disabled') || lower.includes('signups not allowed for otp'))
    return translate("Aucun compte n'est associé à cet email. Crée d'abord un compte.");
  if (lower.includes('phone_provider_disabled') || lower.includes('phone provider'))
    return translate("La connexion par SMS n'est pas encore activée côté serveur.");
  if (lower.includes('provider is not enabled') || lower.includes('unsupported provider') || lower.includes('validation_failed'))
    return translate("Cette connexion sociale n'est pas encore activée côté serveur.");
  if (lower.includes('token has expired') || lower.includes('invalid otp') || lower.includes('otp_expired') || lower.includes('invalid token'))
    return translate('Code invalide ou expiré. Renvoie un nouveau code.');
  if (lower.includes('over_email_send_rate') || lower.includes('rate limit') || lower.includes('too many'))
    return translate('Trop de tentatives. Réessaie dans quelques minutes.');
  if (lower.includes('network') || lower.includes('failed to fetch'))
    return translate('Connexion impossible. Vérifie ta connexion internet.');
  return msg || translate('Une erreur est survenue. Réessaie.');
}
