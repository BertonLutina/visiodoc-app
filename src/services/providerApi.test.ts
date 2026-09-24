import { groupOverrideRows } from './providerApi';

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
