import { clockTime, joinButtonState, pickNextConsultation, showAbsentChoice } from './nextConsultation';

const at = (h: number, m: number) => new Date(2026, 10, 19, h, m, 0).getTime();
const iso = (h: number, m: number) => new Date(at(h, m)).toISOString();

describe('pickNextConsultation', () => {
  it('prend la consultation en cours en priorité', () => {
    const list = [
      { id: 'a', rawStatus: 'scheduled', scheduledAt: iso(10, 0) },
      { id: 'b', rawStatus: 'in_progress', scheduledAt: iso(9, 30) },
    ];
    expect(pickNextConsultation(list, at(9, 45))?.id).toBe('b');
  });
  it('sinon la plus proche à venir, une seule', () => {
    const list = [
      { id: 'late', rawStatus: 'scheduled', scheduledAt: iso(15, 0) },
      { id: 'soon', rawStatus: 'scheduled', scheduledAt: iso(11, 0) },
    ];
    expect(pickNextConsultation(list, at(10, 0))?.id).toBe('soon');
  });
  it('ignore les non payées, annulées et la planifiée dont la fenêtre de 15 min est dépassée', () => {
    const list = [
      { id: 'u', rawStatus: 'pending_payment', scheduledAt: iso(10, 0) },
      { id: 'x', rawStatus: 'cancelled', scheduledAt: iso(10, 0) },
      { id: 'old', rawStatus: 'scheduled', scheduledAt: iso(9, 0) },
    ];
    expect(pickNextConsultation(list, at(10, 0))).toBeNull();
  });
  it('ignore une consultation terminée (après « Terminer », elle n est plus la prochaine)', () => {
    const list = [{ id: 'done', rawStatus: 'completed', scheduledAt: iso(10, 0) }];
    expect(pickNextConsultation(list, at(10, 20))).toBeNull();
  });
  it('garde une planifiée encore dans la fenêtre de 15 min', () => {
    expect(pickNextConsultation([{ id: 'w', rawStatus: 'scheduled', scheduledAt: iso(10, 0) }], at(10, 14))?.id).toBe('w');
  });
});

describe('joinButtonState', () => {
  const c = { rawStatus: 'scheduled', scheduledAt: iso(10, 0) };
  it("grisé avant l'heure prévue (règle serveur : ouverture à l'heure exacte)", () => {
    expect(joinButtonState(c, at(9, 59)).enabled).toBe(false);
    expect(joinButtonState(c, at(10, 0)).enabled).toBe(true);
  });
  it('avec une avance de 2 min : grisé à T-2 min moins 1 s, actif à T-2 min', () => {
    expect(joinButtonState(c, at(10, 0) - 2 * 60_000 - 1000, 2).enabled).toBe(false);
    expect(joinButtonState(c, at(10, 0) - 2 * 60_000, 2).enabled).toBe(true);
  });
  it('toujours actif si en cours ou heure inconnue', () => {
    expect(joinButtonState({ rawStatus: 'in_progress', scheduledAt: iso(18, 0) }, at(9, 0)).enabled).toBe(true);
    expect(joinButtonState({ rawStatus: 'scheduled' }, at(9, 0)).enabled).toBe(true);
  });
});

describe('showAbsentChoice et clockTime', () => {
  it('le choix absent disparaît dès que patient_joined_at est non nul', () => {
    expect(showAbsentChoice(null)).toBe(true);
    expect(showAbsentChoice(undefined)).toBe(true);
    expect(showAbsentChoice('2026-11-19T10:01:00Z')).toBe(false);
  });
  it('formate HH:MM', () => {
    expect(clockTime(at(9, 5))).toBe('09:05');
  });
});
