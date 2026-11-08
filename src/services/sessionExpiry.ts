/**
 * Expiration de session (guide MOB-0612-2) : jeton 30 min, inactivité 1 h, durée max 12 h.
 * Quand le rafraîchissement échoue, la session est purgée et l'utilisateur est invité à se reconnecter.
 */

/** Codes d'erreur GoTrue (snake_case, comparés tels quels). */
const EXPIRY_CODES = ['session_expired', 'refresh_token_not_found', 'refresh_token_already_used'];

/**
 * Phrases de message (texte libre : comparaison insensible à la casse).
 * Formulations GoTrue (`Refresh Token Not Found`, `Already Used`) quand le code manque.
 */
const EXPIRY_PHRASES = [
  'session_expired',
  'refresh_token_not_found',
  'invalid refresh token: session expired',
  'invalid refresh token: refresh token not found',
  // Rotation des jetons : un jeton déjà utilisé invalide la session.
  'refresh_token_already_used',
  'invalid refresh token: already used',
  'jwt expired',
];

const messageMatches = (text: unknown): boolean =>
  typeof text === 'string' && EXPIRY_PHRASES.some((phrase) => text.toLowerCase().includes(phrase));

/**
 * Vrai si l'erreur signifie que la session ne peut plus être rafraîchie ou que le jeton est expiré.
 * Accepte une `Error`, un objet façon `AuthError` (`{ code, message, status }`), un objet réduit à
 * `message` ou à `code`, ou une simple chaîne. Faux pour toute autre valeur (mauvais mot de passe,
 * réseau, null…).
 */
export function isSessionExpiry(error: unknown): boolean {
  if (typeof error === 'string') return messageMatches(error);
  if (!error || typeof error !== 'object') return false;
  const e = error as Record<string, unknown>;
  if (typeof e.code === 'string' && EXPIRY_CODES.includes(e.code)) return true;
  if (typeof e.error_code === 'string' && EXPIRY_CODES.includes(e.error_code)) return true;
  return messageMatches(e.message);
}

/* ---------- Signalement depuis les appels de données (cas « JWT expired ») ---------- */

type Listener = () => void;
const listeners = new Set<Listener>();

/** Abonnement (AuthContext) : appelé quand un appel signale une session expirée. Renvoie le désabonnement. */
export function onSessionExpired(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * À appeler depuis le `catch` d'un service (ou d'un écran) avec l'erreur reçue : si c'est une expiration
 * de session, l'application purge la session et affiche le message de reconnexion. Renvoie vrai dans ce
 * cas (l'appelant peut alors ignorer l'erreur), faux sinon (rien n'est fait).
 */
export function reportSessionExpiry(error: unknown): boolean {
  if (!isSessionExpiry(error)) return false;
  listeners.forEach((listener) => listener());
  return true;
}
