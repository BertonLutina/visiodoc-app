/**
 * Politique d'accès de l'application mobile (guide, 0.3 et étape 2).
 * Module pur, sans dépendance : étendu ensuite avec les statuts `doctor_status`.
 */

export type MobileRole = 'patient' | 'provider';

/**
 * Espace ouvert pour la valeur brute de `users.role`, ou `null` si le rôle n'a pas sa place sur
 * mobile (`super_admin`, `admin`, `country_admin`, `provider_validator`, valeur inconnue ou vide).
 * Insensible à la casse (la contrainte `users_role_check` accepte `PATIENT` comme `patient`).
 */
export function mobileRole(role: string | null | undefined): MobileRole | null {
  switch (String(role ?? '').trim().toLowerCase()) {
    case 'patient':
      return 'patient';
    case 'provider':
    case 'doctor':
      return 'provider';
    default:
      return null;
  }
}
