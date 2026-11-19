/**
 * Numéro saisi → format E.164 attendu par les Edge Functions (`+243899999999`, sans espace).
 *
 * - `+…` : déjà international, on retire seulement espaces et séparateurs (jamais de double indicatif).
 * - `00…` : préfixe d'appel international → `+…`.
 * - sinon numéro local : indicatif du pays choisi + chiffres sans le(s) zéro(s) de tête.
 * Renvoie `undefined` si la saisie ne contient aucun chiffre utile, zéros seuls compris (le champ est alors omis du corps).
 */
/** Longueur du numéro national (sans zéro de tête) des pays pris en charge, par indicatif. */
const NATIONAL_LENGTH: Record<string, number> = { '243': 9, '227': 8, '32': 9, '33': 9, '351': 9 };

export function toE164(input: string | null | undefined, dialCode: string | null | undefined): string | undefined {
  const raw = (input ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return undefined;
  if (raw.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('00')) {
    const international = digits.replace(/^0+/, '');
    return international ? `+${international}` : undefined;
  }
  const national = digits.replace(/^0+/, '');
  if (!national) return undefined;
  const dial = (dialCode ?? '').replace(/\D/g, '');
  // Indicatif déjà saisi sans « + » (`243899999999`) : international si le reste a la longueur
  // d'un numéro national du pays (sinon `243123456` serait un numéro local commençant par 243).
  const expected = NATIONAL_LENGTH[dial];
  if (dial && expected && digits.startsWith(dial) && digits.length - dial.length === expected) {
    return `+${digits}`;
  }
  return dial ? `+${dial}${national}` : national;
}
