import { groupOverrideRows, calculateAge, getPatient } from './providerApi';

describe('saveAvailability', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.dontMock('@/lib/supabase');
  });

  it('only deletes recurrence_type=weekly rows, never touches date overrides', async () => {
    const eq2 = jest.fn().mockResolvedValue({ error: null });
    const eq1 = jest.fn(() => ({ eq: eq2 }));
    const deleteMock = jest.fn(() => ({ eq: eq1 }));
    const insertMock = jest.fn().mockResolvedValue({ error: null });
    const fromMock = jest.fn(() => ({ delete: deleteMock, insert: insertMock }));

    jest.doMock('@/lib/supabase', () => ({
      supabase: { from: fromMock },
      supabasePublic: null,
      supabaseConfigured: true,
    }));

    const { saveAvailability: saveAvailabilityFresh } = require('./providerApi');
    await saveAvailabilityFresh('doc-1', [{ dayOfWeek: 0, startTime: '09:00', endTime: '12:00' }]);

    expect(eq1).toHaveBeenCalledWith('doctor_id', 'doc-1');
    expect(eq2).toHaveBeenCalledWith('recurrence_type', 'weekly');
    expect(insertMock).toHaveBeenCalledWith([
      expect.objectContaining({ day_of_week: 0, start_time: '09:00', end_time: '12:00' }),
    ]);
    const row = insertMock.mock.calls[0][0][0];
    expect(row.valid_from).toBeUndefined();
  });

  it('stores the inclusive period on weekly rows and retries without it if the columns are missing', async () => {
    const eq2 = jest.fn().mockResolvedValue({ error: null });
    const eq1 = jest.fn(() => ({ eq: eq2 }));
    const deleteMock = jest.fn(() => ({ eq: eq1 }));
    const insertMock = jest
      .fn()
      .mockResolvedValueOnce({ error: { code: 'PGRST204', message: "Could not find the 'valid_from' column" } })
      .mockResolvedValueOnce({ error: null });
    const fromMock = jest.fn(() => ({ delete: deleteMock, insert: insertMock }));

    jest.doMock('@/lib/supabase', () => ({
      supabase: { from: fromMock },
      supabasePublic: null,
      supabaseConfigured: true,
    }));

    const { saveAvailability: saveAvailabilityFresh } = require('./providerApi');
    const result = await saveAvailabilityFresh('doc-1', [{ dayOfWeek: 0, startTime: '09:00', endTime: '12:00' }], {
      validFrom: '2026-10-01',
      validTo: '2026-10-31',
    });

    expect(result).toEqual({ periodSynced: false });
    expect(insertMock.mock.calls[0][0][0]).toMatchObject({ valid_from: '2026-10-01', valid_to: '2026-10-31' });
    expect(insertMock.mock.calls[1][0][0].valid_from).toBeUndefined();
  });
});

describe('groupOverrideRows', () => {
  it('groups multiple available rows for the same date into one override with several ranges', () => {
    const rows = [
      { specific_date: '2026-10-15', start_time: '10:00:00', end_time: '13:00:00', is_available: true },
      { specific_date: '2026-10-15', start_time: '15:00:00', end_time: '18:00:00', is_available: true },
    ];
    expect(groupOverrideRows(rows)).toEqual([
      {
        date: '2026-10-15',
        isAvailable: true,
        ranges: [
          { startTime: '10:00', endTime: '13:00' },
          { startTime: '15:00', endTime: '18:00' },
        ],
      },
    ]);
  });

  it('represents a full-day-unavailable row with no ranges', () => {
    const rows = [
      { specific_date: '2026-10-12', start_time: null, end_time: null, is_available: false },
    ];
    expect(groupOverrideRows(rows)).toEqual([
      { date: '2026-10-12', isAvailable: false, ranges: [] },
    ]);
  });

  it('keeps different dates as separate entries, sorted by date', () => {
    const rows = [
      { specific_date: '2026-10-20', start_time: '08:00:00', end_time: '11:00:00', is_available: true },
      { specific_date: '2026-10-12', start_time: null, end_time: null, is_available: false },
    ];
    expect(groupOverrideRows(rows).map((o) => o.date)).toEqual(['2026-10-12', '2026-10-20']);
  });
});

describe('calculateAge', () => {
  it('returns null when date_of_birth is missing', () => {
    expect(calculateAge(null)).toBeNull();
    expect(calculateAge(undefined)).toBeNull();
  });

  it('returns null for an unparseable date instead of NaN', () => {
    expect(calculateAge('not-a-date')).toBeNull();
  });

  it('computes a whole number of years from a birth date', () => {
    const eighteenYearsAgo = new Date();
    eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
    expect(calculateAge(eighteenYearsAgo.toISOString())).toBe(18);
  });

  it('does not count a birthday that has not happened yet this year', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const notYetTurned20 = new Date(tomorrow);
    notYetTurned20.setFullYear(notYetTurned20.getFullYear() - 20);
    expect(calculateAge(notYetTurned20.toISOString())).toBe(19);
  });
});

describe('getPatient', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.dontMock('@/lib/supabase');
  });

  it('reads real clinical columns from users and computes age from date_of_birth', async () => {
    const singleMock = jest.fn().mockResolvedValue({
      data: {
        id: 'pat-1',
        first_name: 'Marie',
        last_name: 'Konaté',
        date_of_birth: '1990-01-01T00:00:00.000Z',
        gender: 'female',
        blood_type: 'O+',
        allergies: 'Pénicilline',
        address: 'Kinshasa',
        emergency_contact_name: 'Jean Konaté',
        emergency_contact_phone: '+243800000000',
      },
      error: null,
    });
    const eqMock = jest.fn(() => ({ single: singleMock }));
    const selectMock = jest.fn(() => ({ eq: eqMock }));
    const fromMock = jest.fn(() => ({ select: selectMock }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: fromMock }, supabasePublic: null, supabaseConfigured: true }));

    const { getPatient: getPatientFresh } = require('./providerApi');
    const result = await getPatientFresh('pat-1');

    expect(fromMock).toHaveBeenCalledWith('users');
    expect(eqMock).toHaveBeenCalledWith('id', 'pat-1');
    expect(result.gender).toBe('female');
    expect(result.bloodType).toBe('O+');
    expect(result.allergiesSummary).toBe('Pénicilline');
    expect(result.age).toBeGreaterThan(30);
  });
});

describe('createMedicalRecord / updateMedicalRecord / archiveMedicalRecord', () => {
  const logMock = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.doMock('./auditLog', () => ({ logMedicalRecordEvent: logMock }));
  });

  afterEach(() => {
    jest.dontMock('@/lib/supabase');
    jest.dontMock('./auditLog');
  });

  it('createMedicalRecord inserts record_type from kind and defaults status to active', async () => {
    const singleMock = jest.fn().mockResolvedValue({ data: { id: 'rec-1' }, error: null });
    const selectMock = jest.fn(() => ({ single: singleMock }));
    const insertMock = jest.fn(() => ({ select: selectMock }));
    const fromMock = jest.fn(() => ({ insert: insertMock }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: fromMock }, supabasePublic: null, supabaseConfigured: true }));

    const { createMedicalRecord: createFresh } = require('./providerApi');
    const result = await createFresh({ patientId: 'pat-1', doctorId: 'doc-1', kind: 'prescription', title: 'Amox' });

    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ record_type: 'prescription', status: 'active', title: 'Amox' }));
    expect(result).toEqual({ id: 'rec-1' });
    expect(logMock).toHaveBeenCalledWith('medical_record:create', 'doc-1', 'pat-1', 'rec-1', 'prescription');
  });

  it('updateMedicalRecord only patches the fields that were provided', async () => {
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    const updateMock = jest.fn(() => ({ eq: eqMock }));
    const fromMock = jest.fn(() => ({ update: updateMock }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: fromMock }, supabasePublic: null, supabaseConfigured: true }));

    const { updateMedicalRecord: updateFresh } = require('./providerApi');
    await updateFresh('rec-1', { doctorId: 'doc-1', patientId: 'pat-1', kind: 'note' }, { title: 'Nouveau titre' });

    expect(updateMock).toHaveBeenCalledWith({ title: 'Nouveau titre' });
    expect(logMock).toHaveBeenCalledWith('medical_record:update', 'doc-1', 'pat-1', 'rec-1', 'note');
  });

  it('updateMedicalRecord writes a changed kind to record_type', async () => {
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    const updateMock = jest.fn(() => ({ eq: eqMock }));
    const fromMock = jest.fn(() => ({ update: updateMock }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: fromMock }, supabasePublic: null, supabaseConfigured: true }));

    const { updateMedicalRecord: updateFresh } = require('./providerApi');
    await updateFresh(
      'rec-1',
      { doctorId: 'doc-1', patientId: 'pat-1', kind: 'note' },
      { kind: 'note', title: 'Devenu une note', metadata: {} },
    );

    expect(updateMock).toHaveBeenCalledWith({ record_type: 'note', title: 'Devenu une note', metadata: {} });
  });

  it('updateMedicalRecord sends null for an explicitly cleared optional field', async () => {
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    const updateMock = jest.fn(() => ({ eq: eqMock }));
    const fromMock = jest.fn(() => ({ update: updateMock }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: fromMock }, supabasePublic: null, supabaseConfigured: true }));

    const { updateMedicalRecord: updateFresh } = require('./providerApi');
    await updateFresh(
      'rec-1',
      { doctorId: 'doc-1', patientId: 'pat-1', kind: 'note' },
      { description: null, category: null, severity: null, startDate: null, endDate: null },
    );

    expect(updateMock).toHaveBeenCalledWith({
      description: null,
      category: null,
      severity: null,
      start_date: null,
      end_date: null,
    });
  });

  it('archiveMedicalRecord sets status to inactive, never deletes the row', async () => {
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    const updateMock = jest.fn(() => ({ eq: eqMock }));
    const fromMock = jest.fn(() => ({ update: updateMock }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: fromMock }, supabasePublic: null, supabaseConfigured: true }));

    const { archiveMedicalRecord: archiveFresh } = require('./providerApi');
    await archiveFresh('rec-1', { doctorId: 'doc-1', patientId: 'pat-1', kind: 'allergy' });

    expect(updateMock).toHaveBeenCalledWith({ status: 'inactive' });
    expect(logMock).toHaveBeenCalledWith('medical_record:archive', 'doc-1', 'pat-1', 'rec-1', 'allergy');
  });
});

describe('getLatestRecordByPatient', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.dontMock('@/lib/supabase');
  });

  it('keeps only the most recent record per patient (rows already ordered desc by created_at)', async () => {
    const rows = [
      { id: 'r2', patient_id: 'pat-1', doctor_id: 'doc-1', record_type: 'prescription', title: 'Récent', status: 'active', created_at: '2026-06-10T00:00:00.000Z' },
      { id: 'r1', patient_id: 'pat-1', doctor_id: 'doc-1', record_type: 'condition', title: 'Ancien', status: 'active', created_at: '2026-05-01T00:00:00.000Z' },
      { id: 'r3', patient_id: 'pat-2', doctor_id: 'doc-1', record_type: 'allergy', title: 'Autre patient', status: 'active', created_at: '2026-06-01T00:00:00.000Z' },
    ];
    const orderMock = jest.fn().mockResolvedValue({ data: rows, error: null });
    const eqMock = jest.fn(() => ({ order: orderMock }));
    const selectMock = jest.fn(() => ({ eq: eqMock }));
    const fromMock = jest.fn(() => ({ select: selectMock }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: fromMock }, supabasePublic: null, supabaseConfigured: true }));

    const { getLatestRecordByPatient: getFresh } = require('./providerApi');
    const result = await getFresh('doc-1');

    expect(result.get('pat-1')?.id).toBe('r2');
    expect(result.get('pat-2')?.id).toBe('r3');
    expect(result.size).toBe(2);
  });
});

describe('getPatientConsultationHistory', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.dontMock('@/lib/supabase');
  });

  it('filters consultations by both doctor and patient, most recent first', async () => {
    const orderMock = jest.fn().mockResolvedValue({ data: [], error: null });
    const eq2Mock = jest.fn(() => ({ order: orderMock }));
    const eq1Mock = jest.fn(() => ({ eq: eq2Mock }));
    const selectMock = jest.fn(() => ({ eq: eq1Mock }));
    const fromMock = jest.fn(() => ({ select: selectMock }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: fromMock }, supabasePublic: null, supabaseConfigured: true }));

    const { getPatientConsultationHistory: getFresh } = require('./providerApi');
    await getFresh('doc-1', 'pat-1');

    expect(eq1Mock).toHaveBeenCalledWith('doctor_id', 'doc-1');
    expect(eq2Mock).toHaveBeenCalledWith('patient_id', 'pat-1');
    expect(orderMock).toHaveBeenCalledWith('scheduled_at', { ascending: false });
  });
});

describe('appendMedicalRecordAttachment', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.dontMock('@/lib/supabase');
  });

  it('appends the new attachment to the existing list rather than replacing it', async () => {
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    const updateMock = jest.fn(() => ({ eq: eqMock }));
    const fromMock = jest.fn(() => ({ update: updateMock }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: fromMock }, supabasePublic: null, supabaseConfigured: true }));

    const { appendMedicalRecordAttachment: appendFresh } = require('./providerApi');
    const existing = [{ name: 'old.pdf', path: 'p/r/old.pdf', type: 'application/pdf', uploadedAt: '2026-01-01T00:00:00.000Z' }];
    const newOne = { name: 'new.jpg', path: 'p/r/new.jpg', type: 'image/jpeg', uploadedAt: '2026-06-01T00:00:00.000Z' };

    await appendFresh('rec-1', existing, newOne);

    expect(updateMock).toHaveBeenCalledWith({ attachments: [...existing, newOne] });
  });
});

describe('provider-side patient gender (male | female | null)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.dontMock('@/lib/supabase');
  });

  const patientRow = (id: string, gender: unknown) => ({
    patient: { id, first_name: 'A', last_name: 'B', date_of_birth: null, gender },
    reason: 'x',
  });

  it('getPatients keeps male/female and maps other, legacy M/F, null and undefined to null', async () => {
    const notMock = jest.fn().mockResolvedValue({
      data: [
        patientRow('p-male', 'male'),
        patientRow('p-female', 'female'),
        patientRow('p-other', 'other'),
        patientRow('p-m', 'M'),
        patientRow('p-null', null),
        patientRow('p-undef', undefined),
      ],
      error: null,
    });
    const eqMock = jest.fn(() => ({ not: notMock }));
    const selectMock = jest.fn(() => ({ eq: eqMock }));
    jest.doMock('@/lib/supabase', () => ({
      supabase: { from: jest.fn(() => ({ select: selectMock })) },
      supabasePublic: null,
      supabaseConfigured: true,
    }));
    const { getPatients } = require('./providerApi');
    const byId = Object.fromEntries((await getPatients('doc-1')).map((p: any) => [p.id, p.gender]));
    expect(byId).toEqual({
      'p-male': 'male',
      'p-female': 'female',
      'p-other': null,
      'p-m': null,
      'p-null': null,
      'p-undef': null,
    });
  });

  it.each([
    ['male', 'male'],
    ['female', 'female'],
    ['other', null],
    ['F', null],
    [null, null],
  ])('getPatient maps DB gender %p to %p', async (db, expected) => {
    const singleMock = jest.fn().mockResolvedValue({
      data: { id: 'pat-1', first_name: 'A', last_name: 'B', date_of_birth: null, gender: db },
      error: null,
    });
    const fromMock = jest.fn(() => ({ select: jest.fn(() => ({ eq: jest.fn(() => ({ single: singleMock })) })) }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: fromMock }, supabasePublic: null, supabaseConfigured: true }));
    const { getPatient: getPatientFresh } = require('./providerApi');
    expect((await getPatientFresh('pat-1')).gender).toBe(expected);
  });
});

describe('getTodayConsultations (agenda du jour / onglet « En cours »)', () => {
  const orderMock = jest.fn();
  const query: any = {};
  beforeEach(() => {
    jest.resetModules();
    orderMock.mockResolvedValue({ data: [], error: null });
    for (const m of ['select', 'eq', 'in', 'neq', 'gte', 'lt']) query[m] = jest.fn(() => query);
    query.order = orderMock;
    jest.doMock('@/lib/supabase', () => ({
      supabase: { from: jest.fn(() => query) },
      supabasePublic: null,
      supabaseConfigured: true,
    }));
  });
  afterEach(() => jest.dontMock('@/lib/supabase'));

  it('excludes only pending_payment in the query: no_show / cancelled stay visible (their badges exist)', async () => {
    await require('./providerApi').getTodayConsultations('d1');
    expect(query.neq).toHaveBeenCalledWith('status', 'pending_payment');
    expect(query.in).not.toHaveBeenCalled();
  });
});

describe('getProviderEarnings (revenus : consultations payées + provider_payouts payés)', () => {
  const calls: Record<string, { method: string; args: unknown[] }[]> = {};
  type Res = { data: unknown; error: unknown };
  const results: Record<string, Res | Res[]> = {};
  const makeQuery = (table: string) => {
    calls[table] = [];
    const q: any = {};
    for (const m of ['select', 'eq', 'in', 'neq', 'gte', 'lt', 'order', 'range', 'not']) {
      q[m] = jest.fn((...args: unknown[]) => {
        calls[table].push({ method: m, args });
        log.push({ table, method: m, args });
        return q;
      });
    }
    q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(Array.isArray(results[table]) ? (results[table] as Res[]).shift() : results[table]).then(resolve, reject);
    return q;
  };
  const log: { table: string; method: string; args: unknown[] }[] = [];
  const logged = (table: string, method: string) => log.filter((c) => c.table === table && c.method === method).map((c) => c.args);
  const filters = (table: string, method: string) => calls[table].filter((c) => c.method === method).map((c) => c.args);

  beforeEach(() => {
    jest.resetModules();
    log.length = 0;
    results.consultations = { data: [], error: null };
    results.provider_payouts = { data: [], error: null };
    jest.doMock('@/lib/supabase', () => ({
      supabase: { from: jest.fn((table: string) => makeQuery(table)) },
      supabasePublic: null,
      supabaseConfigured: true,
    }));
  });
  afterEach(() => jest.dontMock('@/lib/supabase'));

  it('filtre consultations sur exactement doctor_id, les deux statuts et payment_status = paid (aucune commission)', async () => {
    await require('./providerApi').getProviderEarnings('doc-1');
    expect(filters('consultations', 'eq')).toEqual([
      ['doctor_id', 'doc-1'],
      ['payment_status', 'paid'],
    ]);
    expect(filters('consultations', 'in')).toEqual([['status', ['completed', 'no_show']]]);
    expect(String(filters('consultations', 'select')[0][0])).toContain('payment_amount');
    expect(String(filters('consultations', 'select')[0][0])).not.toMatch(/fee/);
  });

  it('lit provider_payouts du prestataire au statut paid, lecture seule', async () => {
    await require('./providerApi').getProviderEarnings('doc-1');
    expect(filters('provider_payouts', 'eq')).toEqual([
      ['provider_id', 'doc-1'],
      ['status', 'paid'],
    ]);
  });

  it('renvoie les montants stockés par devise, sans pourcentage appliqué', async () => {
    results.consultations = {
      data: [
        { status: 'completed', payment_status: 'paid', payment_amount: 100, currency: 'USD', scheduled_at: '2026-10-05T09:00:00.000Z' },
        { status: 'no_show', payment_status: 'paid', payment_amount: 50, currency: 'USD', scheduled_at: '2026-10-06T09:00:00.000Z' },
      ],
      error: null,
    };
    results.provider_payouts = {
      data: [{ status: 'paid', period_start: '2026-09-01', period_end: '2026-09-15', net_amount: 90, currency_code: 'USD' }],
      error: null,
    };
    const e = await require('./providerApi').getProviderEarnings('doc-1');
    expect(e).toEqual({ inProgress: [{ currency: 'USD', amount: 150 }], paid: [{ currency: 'USD', amount: 90 }] });
  });

  it('propage une erreur de lecture consultations', async () => {
    results.consultations = { data: null, error: { message: 'boom' } };
    await expect(require('./providerApi').getProviderEarnings('doc-1')).rejects.toEqual({ message: 'boom' });
  });

  it('si provider_payouts n’a pas de colonne status, relit sans ce filtre (l’existence d’une ligne = versé)', async () => {
    results.provider_payouts = [
      { data: null, error: { code: '42703', message: 'column provider_payouts.status does not exist' } },
      { data: [{ period_start: '2026-09-01', period_end: '2026-09-15', net_amount: 80, currency_code: 'USD' }], error: null },
    ];
    const e = await require('./providerApi').getProviderEarnings('doc-1');
    expect(e.paid).toEqual([{ currency: 'USD', amount: 80 }]);
    expect(filters('provider_payouts', 'eq')).toEqual([['provider_id', 'doc-1']]);
    // Sans colonne status, la ligne n'est « versée » que si paid_at est renseigné.
    expect(filters('provider_payouts', 'not')).toEqual([['paid_at', 'is', null]]);
    expect(String(filters('provider_payouts', 'select')[0][0])).not.toContain('status');
  });

  it('détecte l’absence de colonne status par le code Postgres 42703 même si le message est différent', async () => {
    results.provider_payouts = [
      { data: null, error: { code: '42703', message: 'undefined column' } },
      { data: [{ period_start: '2026-09-01', period_end: '2026-09-15', net_amount: 10, currency_code: 'USD' }], error: null },
    ];
    expect((await require('./providerApi').getProviderEarnings('doc-1')).paid).toEqual([{ currency: 'USD', amount: 10 }]);
  });

  it('une autre erreur sur provider_payouts (ex. RLS 42501) est propagée, sans retry', async () => {
    results.provider_payouts = [{ data: null, error: { code: '42501', message: 'permission denied for table provider_payouts' } }];
    await expect(require('./providerApi').getProviderEarnings('doc-1')).rejects.toMatchObject({ code: '42501' });
  });

  it('mémorise « pas de colonne status » : le second chargement n’envoie plus la requête qui échoue', async () => {
    const payout = { period_start: '2026-09-01', period_end: '2026-09-15', net_amount: 10, currency_code: 'USD' };
    results.provider_payouts = [
      { data: null, error: { code: '42703', message: 'column provider_payouts.status does not exist' } },
      { data: [payout], error: null },
      { data: [payout], error: null },
    ];
    const api = require('./providerApi');
    await api.getProviderEarnings('doc-1');
    log.length = 0;
    const second = await api.getProviderEarnings('doc-1');
    expect(second.paid).toEqual([{ currency: 'USD', amount: 10 }]);
    expect(logged('provider_payouts', 'eq')).toEqual([['provider_id', 'doc-1']]);
    expect(logged('provider_payouts', 'select')).toHaveLength(1);
  });
});

describe('pagination des lectures de revenus (plafond PostgREST de 1000 lignes)', () => {
  type Res = { data: unknown; error: unknown };
  const results: Record<string, Res[]> = {};
  const log: { table: string; method: string; args: unknown[] }[] = [];
  const makeQuery = (table: string) => {
    const q: any = {};
    for (const m of ['select', 'eq', 'in', 'neq', 'gte', 'lt', 'order', 'range', 'not']) {
      q[m] = jest.fn((...args: unknown[]) => {
        log.push({ table, method: m, args });
        return q;
      });
    }
    q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve((results[table] ?? []).shift() ?? { data: [], error: null }).then(resolve, reject);
    return q;
  };
  const rows = (n: number, amount = 10) =>
    Array.from({ length: n }, () => ({
      status: 'completed',
      payment_status: 'paid',
      payment_amount: amount,
      currency: 'USD',
      scheduled_at: '2026-10-05T09:00:00.000Z',
    }));
  const ranges = (table: string) => log.filter((c) => c.table === table && c.method === 'range').map((c) => c.args);

  beforeEach(() => {
    jest.resetModules();
    log.length = 0;
    for (const k of Object.keys(results)) delete results[k];
    jest.doMock('@/lib/supabase', () => ({
      supabase: { from: jest.fn((table: string) => makeQuery(table)) },
      supabasePublic: null,
      supabaseConfigured: true,
    }));
  });
  afterEach(() => jest.dontMock('@/lib/supabase'));

  it('1000 + 250 lignes : les 1250 sont additionnées (12 500)', async () => {
    results.consultations = [
      { data: rows(1000), error: null },
      { data: rows(250), error: null },
    ];
    const e = await require('./providerApi').getProviderEarnings('doc-1');
    expect(e.inProgress).toEqual([{ currency: 'USD', amount: 12500 }]);
    expect(ranges('consultations')).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('exactement 1000 lignes : une seconde requête est faite, une page vide termine la lecture', async () => {
    results.consultations = [
      { data: rows(1000), error: null },
      { data: [], error: null },
    ];
    const e = await require('./providerApi').getProviderEarnings('doc-1');
    expect(e.inProgress).toEqual([{ currency: 'USD', amount: 10000 }]);
    expect(ranges('consultations')).toHaveLength(2);
  });

  it('une erreur sur la page 2 est propagée : jamais de total partiel', async () => {
    results.consultations = [
      { data: rows(1000), error: null },
      { data: null, error: { code: '57014', message: 'statement timeout' } },
    ];
    await expect(require('./providerApi').getProviderEarnings('doc-1')).rejects.toMatchObject({ code: '57014' });
  });

  it('au-delà de 100 pages : erreur explicite plutôt qu’un total tronqué', async () => {
    results.consultations = Array.from({ length: 101 }, () => ({ data: rows(1000, 1), error: null }));
    await expect(require('./providerApi').getProviderEarnings('doc-1')).rejects.toThrow(/trop de lignes|too many/i);
    expect(ranges('consultations')).toHaveLength(100);
  });

  it('getDashboardOverview pagine aussi sa lecture (1000 + 250 consultations)', async () => {
    jest.doMock('./availabilityApi', () => ({
      ...jest.requireActual('./availabilityApi'),
      getSchedulingSettings: jest.fn().mockResolvedValue({ appointmentDurationMinutes: 30 }),
    }));
    const recent = (n: number) =>
      Array.from({ length: n }, () => ({
        id: 'c', patient_id: 'p', duration: 30, status: 'cancelled', payment_status: 'pending', payment_amount: 0, currency: 'USD',
        scheduled_at: new Date().toISOString(),
      }));
    results.consultations = [
      { data: recent(1000), error: null },
      { data: recent(250), error: null },
    ];
    const ov = await require('./providerApi').getDashboardOverview('doc-1');
    // 2 lectures d'aperçu (pages 1 et 2) + les lectures de revenus ; les plages de l'aperçu commencent à 0 puis 1000.
    expect(ranges('consultations')[0]).toEqual([0, 999]);
    expect(ranges('consultations').some((r) => r[0] === 1000)).toBe(true);
    expect(ov.earningsError).toBe(false);
  });

  it('un échec de lecture des revenus lève earningsError au lieu d’afficher « aucun revenu »', async () => {
    jest.doMock('./availabilityApi', () => ({
      ...jest.requireActual('./availabilityApi'),
      getSchedulingSettings: jest.fn().mockResolvedValue({ appointmentDurationMinutes: 30 }),
    }));
    results.provider_payouts = [{ data: null, error: { code: '42501', message: 'permission denied' } }];
    const ov = await require('./providerApi').getDashboardOverview('doc-1');
    expect(ov.earningsError).toBe(true);
    expect(ov.earnings).toEqual({ inProgress: [], paid: [] });
  });
});
