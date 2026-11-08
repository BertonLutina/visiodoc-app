import { translate } from '@/i18n/core';

/** Code d'erreur : compte médecin pas encore validé par l'admin. */
export const PROVIDER_NOT_VALIDATED = 'PROVIDER_NOT_VALIDATED';
export const PROVIDER_PENDING_MESSAGE =
  "Votre inscription n'a pas encore été validée par l'administrateur. Vous recevrez une notification dès l'activation de votre compte.";

export function isProviderPending(e: any): boolean {
  return e?.message === PROVIDER_NOT_VALIDATED;
}

/** Traduit une erreur Supabase Auth/Postgres en message lisible (FR). */
export function authErrorMessage(e: any): string {
  const msg = (e?.message ?? '').toString();
  const lower = msg.toLowerCase();
  if (msg === PROVIDER_NOT_VALIDATED) return translate(PROVIDER_PENDING_MESSAGE);
  if (lower.includes('invalid login credentials')) return translate('Email ou mot de passe incorrect.');
  if (
    lower.includes('already registered') ||
    lower.includes('already been registered') ||
    e?.code === '23505'
  )
    return translate('Un compte existe déjà avec cet email.');
  if (lower.includes('password should be at least'))
    return translate('Le mot de passe doit contenir au moins 6 caractères.');
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
