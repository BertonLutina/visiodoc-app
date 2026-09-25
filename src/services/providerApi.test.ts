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
        gender: 'F',
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
