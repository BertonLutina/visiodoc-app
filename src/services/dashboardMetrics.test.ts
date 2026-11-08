import { buildAlerts, computeDashboardOverview, countdownLabel, weeklyCapacity } from './dashboardMetrics';

const now = new Date(2026, 9, 14, 10, 0); // 14 oct 2026, 10:00 (local)
const iso = (y: number, m: number, d: number, h = 9) => new Date(y, m, d, h).toISOString();
const row = (o: Partial<any>) => ({
  id: Math.random().toString(36).slice(2),
  patient_id: 'p1',
  scheduled_at: iso(2026, 9, 5),
  duration: 30,
  status: 'completed',
  payment_status: 'paid',
  payment_amount: 1000,
  ...o,
});

describe('weeklyCapacity', () => {
  it('somme les créneaux entiers de chaque plage', () => {
    expect(weeklyCapacity([{ startTime: '09:00', endTime: '12:00' }, { startTime: '14:00', endTime: '15:30' }], 30)).toBe(9);
  });
  it('0 sans plage ou durée invalide', () => {
    expect(weeklyCapacity([], 30)).toBe(0);
    expect(weeklyCapacity([{ startTime: '09:00', endTime: '10:00' }], 0)).toBe(0);
  });
});

describe('computeDashboardOverview', () => {
  const o = (rows: any[], capacity = 10) => computeDashboardOverview(rows, { now, feeRate: 0.1, weeklyCapacity: capacity });

  it('une consultation pending_payment (non payée) n\'est jamais la prochaine consultation ni un rendez-vous à venir', () => {
    const unpaid = row({ id: 'unpaid', patient_id: 'a', status: 'pending_payment', payment_status: 'pending', scheduled_at: iso(2026, 9, 15, 9) });
    const paid = row({ id: 'paid', patient_id: 'b', status: 'scheduled', payment_status: 'paid', scheduled_at: iso(2026, 9, 16, 9) });
    expect(o([unpaid, paid]).nextRowId).toBe('paid');
    expect(o([unpaid]).nextRowId).toBeNull();
    expect(o([unpaid]).pendingPayment).toBe(1);
  });

  it('compte les patients distincts hors annulations et les nouveaux du mois', () => {
    const r = o([
      row({ patient_id: 'a', scheduled_at: iso(2026, 8, 1) }),
      row({ patient_id: 'a', scheduled_at: iso(2026, 9, 3) }),
      row({ patient_id: 'b', scheduled_at: iso(2026, 9, 4) }),
      row({ patient_id: 'c', status: 'cancelled', scheduled_at: iso(2026, 9, 4) }),
    ]);
    expect(r.patientsTotal).toBe(2);
    expect(r.patientsNew).toBe(1);
  });

  it('revenu net = payé + terminé, commission déduite ; sinon 0', () => {
    const r = o([
      row({ payment_amount: 1000 }),
      row({ payment_amount: 500, payment_status: 'pending' }),
      row({ payment_amount: 700, status: 'no_show' }),
    ]);
    expect(r.netRevenue).toBe(900);
    expect(r.revenueSeries).toHaveLength(6);
    expect(r.revenueSeries[5].amount).toBe(900);
  });

  it('tendance vs mois précédent, vide si pas de référence', () => {
    const base = [row({ scheduled_at: iso(2026, 9, 2) }), row({ scheduled_at: iso(2026, 9, 3) })];
    expect(o(base).consultationsTrend).toBe('');
    expect(o([...base, row({ scheduled_at: iso(2026, 8, 3) })]).consultationsTrend).toBe('+100% vs mois préc.');
  });

  it('taux d’annulation et no-show sur 90 jours, null sans historique', () => {
    expect(o([]).cancellationRate).toBeNull();
    const r = o([
      row({ status: 'cancelled' }),
      row({ status: 'no_show' }),
      row({}),
      row({}),
    ]);
    expect(r.cancellationRate).toBe(25);
    expect(r.noShowRate).toBe(25);
  });

  it('taux de remplissage borné, null sans capacité', () => {
    const rows = [
      row({ status: 'scheduled', scheduled_at: iso(2026, 9, 14, 15) }),
      row({ status: 'scheduled', scheduled_at: iso(2026, 9, 16, 9) }),
    ];
    expect(o(rows, 4).fillRate).toBe(50);
    expect(o(rows, 1).fillRate).toBe(100);
    expect(o(rows, 0).fillRate).toBeNull();
    expect(o(rows, 4).weekAgenda[0]).toMatchObject({ isToday: true, count: 1 });
  });

  it('patients à relancer : vus il y a > 90 j sans rendez-vous à venir', () => {
    const r = o([
      row({ patient_id: 'old', scheduled_at: iso(2026, 5, 1) }),
      row({ patient_id: 'back', scheduled_at: iso(2026, 5, 1) }),
      row({ patient_id: 'back', status: 'scheduled', scheduled_at: iso(2026, 9, 20) }),
    ]);
    expect(r.patientsToRecall).toBe(1);
  });

  it('prochaine consultation : la première active pas encore terminée', () => {
    const r = o([
      row({ id: 'done', status: 'completed', scheduled_at: iso(2026, 9, 14, 8) }),
      row({ id: 'later', status: 'scheduled', scheduled_at: iso(2026, 9, 15, 9) }),
      row({ id: 'soon', status: 'scheduled', scheduled_at: iso(2026, 9, 14, 11) }),
    ]);
    expect(r.nextRowId).toBe('soon');
  });
});

describe('countdownLabel', () => {
  const t = (min: number) => new Date(now.getTime() + min * 60_000);
  it('formate minutes, heures et jours', () => {
    expect(countdownLabel(t(12), now)).toBe('dans 12 min');
    expect(countdownLabel(t(125), now)).toBe('dans 2 h 05');
    expect(countdownLabel(t(120), now)).toBe('dans 2 h');
    expect(countdownLabel(t(3 * 24 * 60), now)).toBe('dans 3 j');
    expect(countdownLabel(t(-5), now)).toBe('En cours ou imminente');
  });
});

describe('buildAlerts', () => {
  const ov = { weekCapacity: 5, pendingPayment: 0, patientsToRecall: 0 };
  it('aucune alerte quand tout va bien', () => {
    expect(buildAlerts({ validationStatus: 'VALIDATED', overview: ov })).toEqual([]);
  });
  it('signale compte non validé, absence de dispo, paiements et relances', () => {
    const ids = buildAlerts({
      validationStatus: 'PENDING_VALIDATION',
      overview: { weekCapacity: 0, pendingPayment: 2, patientsToRecall: 1 },
    }).map((a) => a.id);
    expect(ids).toEqual(['validation', 'availability', 'pending-payment', 'recall']);
  });
});
