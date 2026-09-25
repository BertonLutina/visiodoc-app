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
