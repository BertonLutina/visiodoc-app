/**
 * « Démarrer » dans la liste prestataire : uniquement pour une consultation `scheduled` (payée) ou déjà
 * `in_progress` (comportement inchangé : on peut y revenir). Jamais pour `pending_payment`, `cancelled`,
 * `no_show` ni `completed`. Sans statut brut (données mock) : comportement précédent (autorisé).
 */
export function canStartConsultation(rawStatus: string | undefined): boolean {
  return rawStatus === undefined || rawStatus === 'scheduled' || rawStatus === 'in_progress';
}

/**
 * Rapport (notes, diagnostic, prescription) : seulement quand le patient s'est connecté, soit `in_progress`
 * ou `completed`. Jamais `scheduled`, `no_show`, `cancelled` ni `pending_payment`.
 */
export function canWriteReport(rawStatus: string | undefined | null): boolean {
  return rawStatus === 'in_progress' || rawStatus === 'completed';
}
