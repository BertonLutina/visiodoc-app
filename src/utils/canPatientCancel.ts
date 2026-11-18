/**
 * « Annuler la consultation » : seulement pour une consultation planifiée (`scheduled` en base, `confirmed` côté
 * app, hors `pending_payment`) dont l'heure prévue n'est pas passée. La règle de crédit reste côté serveur.
 */
export function canPatientCancel(
  c: { status: string; awaitingPayment?: boolean; date: string },
  now: number,
): boolean {
  if (c.status !== 'confirmed' || c.awaitingPayment) return false;
  const at = Date.parse(c.date);
  return Number.isFinite(at) && at > now;
}
