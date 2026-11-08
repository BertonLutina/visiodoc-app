import { translate } from '@/i18n/core';
import { specKey } from '@/services/specializationCatalog';

/** `users.gender` : uniquement `male` ou `female` (guide). `other` est interdit. */
export type Gender = 'male' | 'female';

export const isGender = (v: unknown): v is Gender => v === 'male' || v === 'female';

export interface RegisterPrestaInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  /** Volontairement large : la validation (male/female) se fait dans `buildRegisterPrestaBody`. */
  gender?: string | null;
  phone?: string;
  /** UUID d'un `service_types` officiel, sinon `null` (voir `resolveSpecialty`). */
  serviceTypeId: string | null;
  /** Spécialité hors catalogue proposée par le prestataire, sinon `null`. */
  proposedSpecialtyLabel: string | null;
  countryId?: string;
  city: string;
  licenseNumber: string;
}

export interface RegisterPrestaBody {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  gender: Gender;
  phone: string | undefined;
  serviceTypeId: string | null;
  proposedSpecialtyLabel: string | null;
  countryId: string | undefined;
  city: string;
  licenseNumber: string;
}

/**
 * Corps de `POST /functions/v1/register-presta` (guide « Inscription Prestataire »).
 * Lève AVANT tout appel réseau si le genre est absent ou différent de `male` / `female`.
 */
export function buildRegisterPrestaBody(input: RegisterPrestaInput): RegisterPrestaBody {
  if (!isGender(input.gender)) {
    throw new Error(translate('Choisis ton genre : Masculin ou Féminin.'));
  }
  return {
    email: input.email.trim().toLowerCase(),
    password: input.password,
    firstName: input.firstName,
    lastName: input.lastName,
    gender: input.gender,
    phone: input.phone,
    serviceTypeId: input.serviceTypeId,
    proposedSpecialtyLabel: input.proposedSpecialtyLabel?.trim() || null,
    countryId: input.countryId,
    city: input.city.trim(),
    licenseNumber: input.licenseNumber,
  };
}

/**
 * Traduit le libellé choisi dans le formulaire en `serviceTypeId` (spécialité officielle du
 * catalogue `service_types`) ou, à défaut, en `proposedSpecialtyLabel` (spécialité proposée, comme
 * `suggestSpecializations` : libellé absent de la liste officielle).
 */
export function resolveSpecialty(
  label: string,
  catalog: { id: string; label: string }[],
): { serviceTypeId: string | null; proposedSpecialtyLabel: string | null } {
  const key = specKey(label);
  const match = catalog.find((row) => specKey(row.label) === key);
  if (match) return { serviceTypeId: match.id, proposedSpecialtyLabel: null };
  return { serviceTypeId: null, proposedSpecialtyLabel: label.trim() || null };
}
