import {
  buildAlerts,
  computeDashboardOverview,
  computeProviderEarnings,
  countdownLabel,
  weeklyCapacity,
} from './dashboardMetrics';

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
  currency: 'USD',
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
  const o = (rows: any[], capacity = 10) => computeDashboardOverview(rows, { now, weeklyCapacity: capacity });

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

  it('revenu du mois = payé + (terminé ou no_show), sans commission côté client ; le reste vaut 0', () => {
    const r = o([
      row({ payment_amount: 1000 }),
      row({ payment_amount: 500, payment_status: 'pending' }),
      row({ payment_amount: 700, status: 'no_show' }),
    ]);
    expect(r.netRevenue).toBe(1700);
    expect(r.revenueCurrency).toBe('USD');
    expect(r.revenueSeries).toHaveLength(6);
    expect(r.revenueSeries[5].amount).toBe(1700);
  });

  it('ne mélange pas les devises dans le revenu du mois : seule la devise principale (la plus de consultations payées) alimente le chiffre et le graphique', () => {
    const r = o([
      row({ payment_amount: 100, currency: 'USD' }),
      row({ payment_amount: 70, currency: 'USD' }),
      row({ payment_amount: 50000, currency: 'CDF' }),
    ]);
    expect(r.revenueCurrency).toBe('USD');
    expect(r.netRevenue).toBe(170);
    expect(r.revenueSeries[5].amount).toBe(170);
  });

  it('garde les centimes : aucun arrondi à l’entier, aucun NaN sans consultation', () => {
    expect(o([row({ payment_amount: 12.5 }), row({ payment_amount: 0.25 })]).netRevenue).toBe(12.75);
    const empty = o([]);
    expect(empty.netRevenue).toBe(0);
    expect(empty.revenueCurrency).toBeNull();
    expect(empty.revenueSeries.every((m) => m.amount === 0)).toBe(true);
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

describe('computeProviderEarnings (contrat : consultations payées + provider_payouts payés)', () => {
  const c = (o: Partial<any> = {}) => ({
    status: 'completed',
    payment_status: 'paid',
    payment_amount: 100,
    currency: 'USD',
    scheduled_at: iso(2026, 9, 5),
    ...o,
  });
  const payout = (o: Partial<any> = {}) => ({
    status: 'paid',
    period_start: '2026-09-01',
    period_end: '2026-09-15',
    net_amount: 90,
    currency_code: 'USD',
    ...o,
  });

  it('somme exacte de deux consultations payées terminées / no_show, sans pourcentage appliqué (100 + 50 = 150)', () => {
    const e = computeProviderEarnings([c({ payment_amount: 100 }), c({ payment_amount: 50, status: 'no_show' })], []);
    expect(e.inProgress).toEqual([{ currency: 'USD', amount: 150 }]);
  });

  it('une consultation no_show payée compte', () => {
    expect(computeProviderEarnings([c({ status: 'no_show', payment_amount: 40 })], []).inProgress).toEqual([
      { currency: 'USD', amount: 40 },
    ]);
  });

  it('terminée mais payment_status pending ne compte pas', () => {
    expect(computeProviderEarnings([c({ payment_status: 'pending' })], []).inProgress).toEqual([]);
  });

  it('payée mais scheduled / pending_payment / cancelled / in_progress ne compte pas', () => {
    const rows = ['scheduled', 'pending_payment', 'cancelled', 'in_progress'].map((status) => c({ status }));
    expect(computeProviderEarnings(rows, []).inProgress).toEqual([]);
  });

  it('ne mélange pas les devises', () => {
    const e = computeProviderEarnings(
      [c({ payment_amount: 100, currency: 'USD' }), c({ payment_amount: 25000, currency: 'CDF' }), c({ payment_amount: 20, currency: 'USD' })],
      [],
    );
    expect(e.inProgress).toEqual([
      { currency: 'CDF', amount: 25000 },
      { currency: 'USD', amount: 120 },
    ]);
  });

  it('liste vide : aucune ligne, jamais NaN', () => {
    expect(computeProviderEarnings([], [])).toEqual({ inProgress: [], paid: [] });
  });

  it('montants null / undefined / non numériques comptent 0', () => {
    const e = computeProviderEarnings(
      [c({ payment_amount: null }), c({ payment_amount: undefined }), c({ payment_amount: 30 })],
      [payout({ net_amount: null })],
    );
    expect(e.inProgress).toEqual([{ currency: 'USD', amount: 30 }]);
    expect(e.paid).toEqual([{ currency: 'USD', amount: 0 }]);
  });

  it('les périodes payées viennent de provider_payouts (net_amount) ; un reversement pending est ignoré', () => {
    const e = computeProviderEarnings(
      [],
      [
        payout({ net_amount: 90 }),
        payout({ net_amount: 45.5, period_start: '2026-09-16', period_end: '2026-09-30' }),
        payout({ net_amount: 999, status: 'pending' }),
      ],
    );
    expect(e.paid).toEqual([{ currency: 'USD', amount: 135.5 }]);
  });

  it('une consultation déjà couverte par une période payée n’est pas recomptée dans « en cours »', () => {
    const e = computeProviderEarnings(
      [
        c({ payment_amount: 100, scheduled_at: iso(2026, 8, 10) }), // dans 1–15 sept : déjà versée
        c({ payment_amount: 60, scheduled_at: iso(2026, 8, 20) }), // 16–30 sept : en cours
      ],
      [payout()],
    );
    expect(e.inProgress).toEqual([{ currency: 'USD', amount: 60 }]);
    expect(e.paid).toEqual([{ currency: 'USD', amount: 90 }]);
  });

  it('un reversement pending ne masque pas les consultations de sa période', () => {
    const e = computeProviderEarnings(
      [c({ payment_amount: 100, scheduled_at: iso(2026, 8, 10) })],
      [payout({ status: 'pending' })],
    );
    expect(e.inProgress).toEqual([{ currency: 'USD', amount: 100 }]);
  });

  it('les centimes sont conservés sans dérive flottante (0.1 + 0.2 = 0.3)', () => {
    expect(computeProviderEarnings([c({ payment_amount: 0.1 }), c({ payment_amount: 0.2 })], []).inProgress).toEqual([
      { currency: 'USD', amount: 0.3 },
    ]);
  });
});
