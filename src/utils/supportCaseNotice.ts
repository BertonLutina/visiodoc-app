/**
 * Cas support « paiement reçu mais consultation non confirmée » : l'alerte n'est montrée qu'UNE fois par
 * `txnRef` et par session d'application (Set en mémoire au niveau du module : survit à un changement d'onglet,
 * pas à un redémarrage). La ligne de la consultation, elle, reste affichée en permanence.
 */
export interface SupportCaseRef {
  consultationId: string;
  txnRef: string;
}

export function createSupportCaseNotifier() {
  const notified = new Set<string>();
  return {
    /** Renvoie les cas jamais notifiés (et les marque comme notifiés). */
    takeNew(cases: SupportCaseRef[]): SupportCaseRef[] {
      const fresh: SupportCaseRef[] = [];
      for (const c of cases) {
        if (notified.has(c.txnRef)) continue;
        notified.add(c.txnRef);
        fresh.push(c);
      }
      return fresh;
    },
    /** `{ [consultationId]: txnRef }` pour la ligne persistante de chaque carte. */
    byConsultation(cases: SupportCaseRef[]): Record<string, string> {
      return Object.fromEntries(cases.map((c) => [c.consultationId, c.txnRef]));
    },
  };
}

/** Instance de session partagée par l'écran « Mes consultations ». */
export const supportCaseNotifier = createSupportCaseNotifier();
