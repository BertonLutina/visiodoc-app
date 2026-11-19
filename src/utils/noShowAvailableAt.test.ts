import { noShowAvailableAt, noShowButtonState, NO_SHOW_WAIT_MS } from './noShowAvailableAt';

const S = '2026-11-20T10:00:00.000Z';
const ms = (iso: string) => new Date(iso).getTime();

describe('noShowAvailableAt', () => {
  it('sans started_at : scheduled_at + 15 min', () => {
    expect(noShowAvailableAt(S, null)?.getTime()).toBe(ms(S) + NO_SHOW_WAIT_MS);
  });
  it("started_at après l'heure du RDV : started_at + 15 min", () => {
    const st = '2026-11-20T10:07:00.000Z';
    expect(noShowAvailableAt(S, st)?.getTime()).toBe(ms(st) + NO_SHOW_WAIT_MS);
  });
  it("started_at avant l'heure du RDV : GREATEST(scheduled_at, started_at + 15 min)", () => {
    const early = '2026-11-20T09:55:00.000Z'; // +15 = 10:10 > 10:00
    expect(noShowAvailableAt(S, early)?.getTime()).toBe(ms(early) + NO_SHOW_WAIT_MS);
    const veryEarly = '2026-11-20T09:00:00.000Z'; // +15 = 09:15 < 10:00
    expect(noShowAvailableAt(S, veryEarly)?.getTime()).toBe(ms(S));
  });
  it('null si scheduled_at absent ou invalide', () => {
    expect(noShowAvailableAt(null, null)).toBeNull();
    expect(noShowAvailableAt('nope', null)).toBeNull();
  });
});

describe('noShowButtonState', () => {
  const at = new Date(ms(S) + NO_SHOW_WAIT_MS);
  it('désactivé avec minutes restantes (arrondi au supérieur)', () => {
    expect(noShowButtonState({ availableAt: at, now: ms(S) })).toEqual({ enabled: false, reason: 'wait', minutes: 15 });
    expect(noShowButtonState({ availableAt: at, now: at.getTime() - 1000 })).toEqual({ enabled: false, reason: 'wait', minutes: 1 });
  });
  it('actif une fois le délai atteint', () => {
    expect(noShowButtonState({ availableAt: at, now: at.getTime() })).toEqual({ enabled: true });
  });
  it('patientJoinedAt non nul : désactivé, raison joined', () => {
    expect(noShowButtonState({ availableAt: at, now: at.getTime() + 1e6, patientJoinedAt: '2026-11-20T10:01:00Z' })).toEqual({
      enabled: false,
      reason: 'joined',
    });
  });
  it('heure inconnue : actif (le serveur reste juge)', () => {
    expect(noShowButtonState({ availableAt: null, now: 0 })).toEqual({ enabled: true });
  });
});
