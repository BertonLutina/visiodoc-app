import { localDayTimeLabel, localTimeLabel } from './localMoment';

describe('localMoment (heure locale de l\'appareil, jamais UTC)', () => {
  const now = new Date(2026, 10, 19, 10, 0); // jeudi 19/11, heure locale

  it('localTimeLabel : 12h42, minutes zéro-complétées', () => {
    expect(localTimeLabel(new Date(2026, 10, 22, 12, 42))).toBe('12h42');
    expect(localTimeLabel(new Date(2026, 10, 22, 9, 5))).toBe('9h05');
  });

  it('suit les getters locaux (pas getUTCHours)', () => {
    const iso = new Date(2026, 10, 22, 12, 42).toISOString();
    expect(localDayTimeLabel(iso, now)).toBe('dimanche 22/11 à 12h42');
  });

  it('aujourd\'hui et demain', () => {
    expect(localDayTimeLabel(new Date(2026, 10, 19, 17, 30).toISOString(), now)).toBe("aujourd'hui à 17h30");
    expect(localDayTimeLabel(new Date(2026, 10, 20, 8, 0).toISOString(), now)).toBe('demain à 8h00');
  });

  it('null si absent ou invalide', () => {
    expect(localDayTimeLabel(undefined, now)).toBeNull();
    expect(localDayTimeLabel('nope', now)).toBeNull();
  });
});
