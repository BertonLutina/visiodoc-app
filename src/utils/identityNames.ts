import { translate } from '@/i18n/core';

export interface IdentityNames {
  firstName?: string;
  lastName?: string;
  postNom?: string;
}

/**
 * Règle des noms (même règle que le web, `isIdentityComplete`) : le nom de famille est toujours
 * obligatoire. Si le pays utilise le post-nom (`countries.uses_postnom`), il faut au moins un des deux
 * entre prénom et post-nom (les deux sont permis) ; sinon le prénom est obligatoire.
 */
export function identityNamesComplete(names: IdentityNames, usesPostnom: boolean): boolean {
  const hasLast = !!names.lastName?.trim();
  const hasFirst = !!names.firstName?.trim();
  const hasPostNom = !!names.postNom?.trim();
  if (!hasLast) return false;
  return usesPostnom ? hasFirst || hasPostNom : hasFirst;
}

/** Message d'erreur traduit, ou `null` si les noms sont valides. */
export function identityNamesIssue(names: IdentityNames, usesPostnom: boolean): string | null {
  if (identityNamesComplete(names, usesPostnom)) return null;
  return usesPostnom
    ? translate('Le nom est obligatoire, ainsi que le prénom ou le post-nom.')
    : translate('Le nom et le prénom sont obligatoires.');
}
