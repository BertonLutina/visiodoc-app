import { translate } from '@/i18n/core';

/** Politique commune web/mobile (guide MOB-0611-3) : 10 à 72 caractères, une lettre, un chiffre. */
const MIN_LEN = 10;
const MAX_LEN = 72;
const PASSWORD_REGEX = new RegExp(`^(?=.*[a-zA-Z])(?=.*[0-9]).{${MIN_LEN},${MAX_LEN}}$`);

export type PasswordIssue = 'too_short' | 'too_long' | 'needs_letter_and_digit';

/** `null` si le mot de passe respecte la politique, sinon la première règle non respectée. */
export function passwordIssue(password: string): PasswordIssue | null {
  if (password.length < MIN_LEN) return 'too_short';
  if (password.length > MAX_LEN) return 'too_long';
  if (!PASSWORD_REGEX.test(password)) return 'needs_letter_and_digit';
  return null;
}

/** Message FR (traduit) à afficher pour une règle non respectée. */
export function passwordIssueMessage(issue: PasswordIssue): string {
  switch (issue) {
    case 'too_short':
      return translate('Le mot de passe doit contenir au moins 10 caractères.');
    case 'too_long':
      return translate('Le mot de passe ne doit pas dépasser 72 caractères.');
    case 'needs_letter_and_digit':
      return translate('Le mot de passe doit contenir au moins une lettre et un chiffre.');
  }
}

export type PasswordStrength = 'weak' | 'ok' | 'strong';

/** Indicateur simple : faible tant que la politique n'est pas respectée, fort à partir de 14 caractères. */
export function passwordStrength(password: string): PasswordStrength {
  if (passwordIssue(password) !== null) return 'weak';
  return password.length >= 14 ? 'strong' : 'ok';
}
