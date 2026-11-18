// Réservation « pour moi » / « pour mon enfant » (MOB-1311-1 §3 et §4) : règles pures, testées.

export type BookingFor = 'self' | 'child';

export type BookingTarget =
  | { ok: true; childId: string | null }
  | { ok: false; reason: 'provider_does_not_accept_children' | 'child_required' };

/**
 * Qui est le bénéficiaire de la réservation. « Pour moi » renvoie `childId: null` (le champ `child_id` n'est alors
 * pas envoyé). Un enfant n'est réservable que chez un prestataire qui accepte les enfants (`accepts_children`
 * strictement vrai) et seulement si un enfant est choisi.
 */
export function resolveBookingTarget(args: {
  bookingFor: BookingFor;
  childId: string | null;
  providerAcceptsChildren: boolean | null | undefined;
}): BookingTarget {
  if (args.bookingFor === 'self') return { ok: true, childId: null };
  if (args.providerAcceptsChildren !== true) return { ok: false, reason: 'provider_does_not_accept_children' };
  if (!args.childId) return { ok: false, reason: 'child_required' };
  return { ok: true, childId: args.childId };
}

/** Si le prestataire n'accepte pas les enfants, la réservation repasse sur « pour moi ». */
export function effectiveBookingFor(bookingFor: BookingFor, providerAcceptsChildren: boolean | null | undefined): BookingFor {
  return bookingFor === 'child' && providerAcceptsChildren !== true ? 'self' : bookingFor;
}

const sameNumber = (a: number | null, b: number | null) => a === b;

/**
 * Les mesures sont préremplies avec les dernières connues : elles ne sont enregistrées que si l'une d'elles a
 * réellement changé, et seulement la ou les valeurs renseignées.
 */
export function measurementsToRecord(
  entered: { weightKg: number | null; heightCm: number | null },
  known: { weightKg: number | null; heightCm: number | null } | null,
): { weightKg: number | null; heightCm: number | null } | null {
  if (entered.weightKg === null && entered.heightCm === null) return null;
  const weightChanged = entered.weightKg !== null && !sameNumber(entered.weightKg, known?.weightKg ?? null);
  const heightChanged = entered.heightCm !== null && !sameNumber(entered.heightCm, known?.heightCm ?? null);
  if (!weightChanged && !heightChanged) return null;
  return {
    weightKg: weightChanged ? entered.weightKg : null,
    heightCm: heightChanged ? entered.heightCm : null,
  };
}
