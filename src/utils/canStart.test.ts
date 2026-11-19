import { canStartConsultation, canWriteReport } from './canStart';

describe('canStartConsultation ("Démarrer" on the provider list)', () => {
  it('only for a scheduled consultation, or one already in progress (rejoin: behaviour unchanged)', () => {
    expect(canStartConsultation('scheduled')).toBe(true);
    expect(canStartConsultation('in_progress')).toBe(true);
  });
  it('never for unpaid, cancelled, no-show or completed rows', () => {
    for (const status of ['pending_payment', 'cancelled', 'no_show', 'completed']) {
      expect(canStartConsultation(status)).toBe(false);
    }
  });
  it('rows without a raw status (mock data) keep the previous behaviour', () => {
    expect(canStartConsultation(undefined)).toBe(true);
  });
});

describe('canWriteReport', () => {
  it('seulement en cours ou terminée', () => {
    expect(canWriteReport('in_progress')).toBe(true);
    expect(canWriteReport('completed')).toBe(true);
    for (const st of ['scheduled', 'no_show', 'cancelled', 'pending_payment', undefined, null, '']) {
      expect(canWriteReport(st as any)).toBe(false);
    }
  });
});
