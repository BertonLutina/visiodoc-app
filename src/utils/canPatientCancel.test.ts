import { canPatientCancel } from './canPatientCancel';

const now = Date.parse('2026-11-19T10:00:00.000Z');
const future = '2026-11-20T10:00:00.000Z';

describe('canPatientCancel', () => {
  it('autorise une consultation planifiée dans le futur', () => {
    expect(canPatientCancel({ status: 'confirmed', date: future }, now)).toBe(true);
  });
  it("refuse si l'heure prévue est passée ou égale", () => {
    expect(canPatientCancel({ status: 'confirmed', date: '2026-11-19T09:59:00.000Z' }, now)).toBe(false);
    expect(canPatientCancel({ status: 'confirmed', date: '2026-11-19T10:00:00.000Z' }, now)).toBe(false);
  });
  it('refuse une date illisible', () => {
    expect(canPatientCancel({ status: 'confirmed', date: 'bientôt' }, now)).toBe(false);
  });
  it('refuse en attente de paiement, en cours, terminée, annulée', () => {
    expect(canPatientCancel({ status: 'pending', awaitingPayment: true, date: future }, now)).toBe(false);
    expect(canPatientCancel({ status: 'confirmed', awaitingPayment: true, date: future }, now)).toBe(false);
    for (const status of ['pending', 'in_progress', 'completed', 'cancelled']) {
      expect(canPatientCancel({ status, date: future }, now)).toBe(false);
    }
  });
});
