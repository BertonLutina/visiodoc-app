import { reportSessionExpiry } from '@/services/sessionExpiry';

/**
 * Catch commun des chargements d'écran (`useAsync`) : un « JWT expired » remonté par un appel de données
 * déclenche la reconnexion (`reportSessionExpiry`, une fois par erreur) ; toute autre erreur est inchangée.
 * Renvoie le message à afficher.
 */
export function handleLoadError(error: unknown): string {
  reportSessionExpiry(error);
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && message ? message : 'Erreur de chargement';
}
