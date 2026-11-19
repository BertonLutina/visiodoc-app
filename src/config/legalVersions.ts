/**
 * Versions des textes juridiques dont l'acceptation est enregistrée (MOB-1811-6).
 * Source unique : à modifier ici seulement, à chaque nouvelle version des textes.
 */
export const LEGAL_VERSIONS = {
  cguPatient: 'CGU-PATIENT-v2',
  cguPro: 'CGU-PRO-v2',
  privacy: 'CONFID-v2',
  healthConsent: 'CONSENT-SANTE-v1',
} as const;

/** Plateforme envoyée au serveur (`legalAcceptance.platform`, `p_platform`). */
export const LEGAL_PLATFORM = 'mobile' as const;

/**
 * Valeur initiale de la case « données de santé » (inscription patient par e-mail, identité du parcours téléphone).
 * Décision produit de Chris (19/11/2026) ; avis RGPD contraire (consentement explicite, CJUE Planet49)
 * à faire valider par le juriste. L'utilisateur peut décocher ; décochée, l'inscription est refusée avant réseau.
 */
export const HEALTH_CONSENT_DEFAULT = true;
