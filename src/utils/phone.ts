/**
 * Numéro saisi → format E.164 attendu par les Edge Functions (`+243899999999`, sans espace).
 *
 * - `+…` : déjà international, on retire seulement espaces et séparateurs (jamais de double indicatif).
 * - `00…` : préfixe d'appel international → `+…`.
 * - sinon numéro local : indicatif du pays choisi + chiffres sans le(s) zéro(s) de tête.
 * Renvoie `undefined` si la saisie ne contient aucun chiffre (le champ est alors omis du corps).
 */
export function toE164(input: string | null | undefined, dialCode: string | null | undefined): string | undefined {
  const raw = (input ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return undefined;
  if (raw.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('00')) return `+${digits.replace(/^0+/, '')}`;
  const national = digits.replace(/^0+/, '');
  if (!national) return undefined;
  const dial = (dialCode ?? '').replace(/\D/g, '');
  return dial ? `+${dial}${national}` : national;
}
