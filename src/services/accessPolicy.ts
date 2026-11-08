/**
 * Politique d'accès de l'application mobile (guide, 0.3 et étape 2).
 * Module pur, sans dépendance : rôle mobile (`users.role`) et garde prestataire (`users.doctor_status`).
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

/** Décision d'accès d'un prestataire, dérivée de `users.doctor_status` et `users.is_active`. */
export type ProviderGate = 'full' | 'subscribe' | 'pending' | 'rejected' | 'incomplete' | 'suspended';

/**
 * Garde prestataire (guide, étape 7). La contrainte `users_doctor_status_check` n'autorise que 7
 * valeurs, comparées STRICTEMENT (aucun changement de casse : `valide_abo_actif` n'existe pas) :
 * `VALIDE_ABO_ACTIF`, `VALIDE_SANS_ABO`, `EN_ATTENTE_VALIDATION`, `en_attente_de_validation`,
 * `profil_incomplet`, `profil_valide`, `profil_rejete`.
 * Un compte suspendu est `is_active = false` (jamais une valeur de `doctor_status`), testé en premier.
 * Toute autre valeur (absente, vide, inconnue, casse différente) ressemble à un dossier à finaliser.
 */
export function providerGate(status: string | null | undefined, isActive: boolean | undefined): ProviderGate {
  if (isActive === false) return 'suspended';
  switch (status) {
    case 'VALIDE_ABO_ACTIF':
      return 'full';
    case 'VALIDE_SANS_ABO':
    case 'profil_valide':
      return 'subscribe';
    case 'en_attente_de_validation':
    case 'EN_ATTENTE_VALIDATION':
      return 'pending';
    case 'profil_rejete':
      return 'rejected';
    default:
      return 'incomplete';
  }
}

/**
 * Écran d'arrivée d'un utilisateur déjà connecté. Seul un prestataire `full` ouvre l'espace
 * prestataire ; `subscribe` reste connecté et tombe sur l'abonnement. Les autres états de la garde
 * ne gardent pas de session (voir `guardProvider`), le repli est donc l'abonnement, jamais l'agenda.
 */
export function providerHomeHref(user: {
  role: string;
  doctorStatus?: string | null;
  isActive?: boolean;
}): '/(patient)' | '/(provider)' | '/provider/subscription' {
  if (user.role !== 'provider') return '/(patient)';
  return providerGate(user.doctorStatus, user.isActive) === 'full' ? '/(provider)' : '/provider/subscription';
}

/**
 * Motif de refus de connexion d'un utilisateur, ou `null` s'il peut ouvrir une session : un patient
 * n'est jamais filtré, un prestataire `full` ou `subscribe` reste connecté (l'abonnement se règle
 * dans l'application), les autres états de la garde ferment la session.
 */
export function providerRefusalReason(user: {
  role: string;
  doctorStatus?: string | null;
  isActive?: boolean;
}): Exclude<ProviderGate, 'full' | 'subscribe'> | null {
  if (user.role !== 'provider') return null;
  const gate = providerGate(user.doctorStatus, user.isActive);
  return gate === 'full' || gate === 'subscribe' ? null : gate;
}
