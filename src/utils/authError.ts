import { translate } from '@/i18n/core';

/** Code d'erreur : compte médecin pas encore validé par l'admin. */
export const PROVIDER_NOT_VALIDATED = 'PROVIDER_NOT_VALIDATED';
export const PROVIDER_PENDING_MESSAGE =
  "Votre inscription n'a pas encore été validée par l'administrateur. Vous recevrez une notification dès l'activation de votre compte.";

export function isProviderPending(e: any): boolean {
  return e?.message === PROVIDER_NOT_VALIDATED;
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

/** Traduit une erreur Supabase Auth/Postgres en message lisible (FR). */
export function authErrorMessage(e: any): string {
  const msg = (e?.message ?? '').toString();
  const lower = msg.toLowerCase();
  if (msg === PROVIDER_NOT_VALIDATED) return translate(PROVIDER_PENDING_MESSAGE);
  const pwned = pwnedPasswordMessage(e);
  if (pwned) return pwned;
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
  if (lower.includes('email not confirmed'))
    return translate('Confirme ton email avant de te connecter.');
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
