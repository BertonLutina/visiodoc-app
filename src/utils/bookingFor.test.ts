import { effectiveBookingFor, measurementsToRecord, resolveBookingTarget } from './bookingFor';

describe('resolveBookingTarget', () => {
  it('« pour moi » : aucun enfant, quel que soit le prestataire', () => {
    expect(resolveBookingTarget({ bookingFor: 'self', childId: 'c1', providerAcceptsChildren: false })).toEqual({
      ok: true,
      childId: null,
    });
  });

  it('un enfant n’est réservable que chez un prestataire accepts_children (vide, false ou null refusés)', () => {
    for (const accepts of [false, null, undefined]) {
      expect(resolveBookingTarget({ bookingFor: 'child', childId: 'c1', providerAcceptsChildren: accepts })).toEqual({
        ok: false,
        reason: 'provider_does_not_accept_children',
      });
    }
    expect(resolveBookingTarget({ bookingFor: 'child', childId: 'c1', providerAcceptsChildren: true })).toEqual({
      ok: true,
      childId: 'c1',
    });
  });

  it('exige un enfant choisi', () => {
    expect(resolveBookingTarget({ bookingFor: 'child', childId: null, providerAcceptsChildren: true })).toEqual({
      ok: false,
      reason: 'child_required',
    });
  });
});

describe('effectiveBookingFor', () => {
  it('repasse sur « pour moi » quand le prestataire n’accepte pas les enfants', () => {
    expect(effectiveBookingFor('child', false)).toBe('self');
    expect(effectiveBookingFor('child', true)).toBe('child');
    expect(effectiveBookingFor('self', true)).toBe('self');
  });
});

describe('measurementsToRecord (poids et taille optionnels, enregistrés seulement s’ils changent)', () => {
  const known = { weightKg: 18, heightCm: 110 };

  it('rien à enregistrer si rien n’est saisi ou si rien n’a changé', () => {
    expect(measurementsToRecord({ weightKg: null, heightCm: null }, known)).toBeNull();
    expect(measurementsToRecord({ weightKg: 18, heightCm: 110 }, known)).toBeNull();
  });

  it('n’enregistre que la valeur modifiée (mesure partielle)', () => {
    expect(measurementsToRecord({ weightKg: 19, heightCm: 110 }, known)).toEqual({ weightKg: 19, heightCm: null });
    expect(measurementsToRecord({ weightKg: 18, heightCm: 112 }, known)).toEqual({ weightKg: null, heightCm: 112 });
  });

  it('enregistre une première mesure partielle quand rien n’était connu', () => {
    expect(measurementsToRecord({ weightKg: 15, heightCm: null }, null)).toEqual({ weightKg: 15, heightCm: null });
  });
});
