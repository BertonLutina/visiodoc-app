import type { ProviderPatient } from '@/types/provider';

/**
 * Route de la fiche d'une ligne « patient ». Une ligne d'enfant ouvre la fiche DE L'ENFANT (paramètre childId) :
 * le dossier du parent n'est jamais ouvert depuis la ligne d'un enfant.
 */
export function patientRoute(p: Pick<ProviderPatient, 'id' | 'patientId' | 'childId'>): string {
  const base = `/patient/${p.patientId ?? p.id}`;
  return p.childId ? `${base}?childId=${p.childId}` : base;
}
