/** Le serveur libère un créneau `pending_payment` non payé au bout de 15 minutes. */
export const PAY_WINDOW_MS = 15 * 60_000;

/**
 * Faut-il proposer « Payer maintenant » ? Non si la consultation n'attend pas de paiement, si le rendez-vous
 * est passé, ou si l'âge (`created_at`) dépasse la fenêtre de 15 min — sauf si une tentative locale existe
 * (reprise de la confirmation / reprise explicite après 15 min doivent rester accessibles).
 */
export function canPayNow(
  c: { awaitingPayment?: boolean; date: string; createdAt?: string },
  now: number,
  hasStoredAttempt: boolean,
): boolean {
  if (!c.awaitingPayment) return false;
  const at = Date.parse(c.date);
  if (Number.isFinite(at) && at <= now) return false;
  if (!hasStoredAttempt && c.createdAt) {
    const created = Date.parse(c.createdAt);
    if (Number.isFinite(created) && now - created > PAY_WINDOW_MS) return false;
  }
  return true;
}
