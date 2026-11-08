import { buildMonthAvailability } from './availabilityApi';
import { DEFAULT_SETTINGS, type WeeklyRule } from './availabilityEngine';

describe('buildMonthAvailability', () => {
  it('marks every day unavailable when there are no rules at all (new provider)', () => {
    const now = new Date(2026, 9, 1, 8, 0);
    const result = buildMonthAvailability(2026, 10, [], [], DEFAULT_SETTINGS, [], now);
    const values = new Set(Object.values(result));
    expect(values).toEqual(new Set(['unavailable']));
    expect(Object.keys(result)).toHaveLength(31);
  });

  it('marks a weekday with bookable slots as available', () => {
    // A day ahead of the whole month so DEFAULT_SETTINGS.minimumNoticeMinutes (120min)
    // never eats into the 09:00-10:00 range being tested.
    const now = new Date(2026, 8, 30, 8, 0);
    const weekly: WeeklyRule[] = [{ dayOfWeek: 3, startTime: '09:00', endTime: '10:00' }]; // Thursdays
    const result = buildMonthAvailability(2026, 10, weekly, [], DEFAULT_SETTINGS, [], now);
    // 2026-10-01 is a Thursday
    expect(result['2026-10-01']).toBe('available');
    expect(result['2026-10-02']).toBe('unavailable'); // Friday, no rule
  });
});

// ---------------------------------------------------------------------------
// Créneaux occupés : RPC `doctor_busy_slots` (session obligatoire, 62 jours max)
// ---------------------------------------------------------------------------
describe('busy slots via doctor_busy_slots', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const MAX_WINDOW = 62 * DAY;
  const FROM = new Date('2026-11-01T00:00:00.000Z');

  const rpc = jest.fn();
  const sessionFrom = jest.fn();
  const publicFrom = jest.fn();

  /** Chaînable et « awaitable » : toute chaîne .select().eq()... se résout en { data, error }. */
  const queryChain = (result: { data: any; error: any }) => {
    const chain: any = {};
    for (const m of ['select', 'eq', 'gte', 'lte', 'lt', 'in']) chain[m] = jest.fn(() => chain);
    chain.maybeSingle = jest.fn(() => Promise.resolve(result));
    chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
    return chain;
  };

  const load = () => require('./availabilityApi') as typeof import('./availabilityApi');
  const range = (ms: number) => new Date(FROM.getTime() + ms);

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    rpc.mockResolvedValue({ data: [], error: null });
    sessionFrom.mockImplementation(() => queryChain({ data: [], error: null }));
    publicFrom.mockImplementation(() => queryChain({ data: [], error: null }));
    jest.doMock('@/lib/supabase', () => ({
      supabase: { rpc, from: sessionFrom },
      supabasePublic: { from: publicFrom, rpc: jest.fn() },
      supabaseConfigured: true,
    }));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.dontMock('@/lib/supabase');
  });

  it('splits a 90-day range into 2 contiguous windows of at most 62 days covering exactly [from, to]', async () => {
    const to = range(90 * DAY);
    await load().fetchBookedRanges('doc-1', FROM, to, { signedIn: true });

    expect(rpc).toHaveBeenCalledTimes(2);
    const calls = rpc.mock.calls.map(([, args]) => args);
    expect(rpc.mock.calls.every(([name]) => name === 'doctor_busy_slots')).toBe(true);
    expect(calls[0]).toEqual({
      p_doctor_id: 'doc-1',
      p_from: '2026-11-01T00:00:00.000Z',
      p_to: '2027-01-02T00:00:00.000Z', // from + 62 j
    });
    expect(calls[1]).toEqual({
      p_doctor_id: 'doc-1',
      p_from: '2027-01-02T00:00:00.000Z', // contigu : pas de trou ni de chevauchement
      p_to: '2027-01-30T00:00:00.000Z', // = to
    });
    for (const c of calls) {
      expect(new Date(c.p_to).getTime() - new Date(c.p_from).getTime()).toBeLessThanOrEqual(MAX_WINDOW);
    }
  });

  it('makes a single call for exactly 62 days', async () => {
    await load().fetchBookedRanges('doc-1', FROM, range(MAX_WINDOW), { signedIn: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('doctor_busy_slots', {
      p_doctor_id: 'doc-1',
      p_from: '2026-11-01T00:00:00.000Z',
      p_to: '2027-01-02T00:00:00.000Z',
    });
  });

  it('makes 2 calls for 62 days + 1 ms, the second covering only that millisecond', async () => {
    await load().fetchBookedRanges('doc-1', FROM, range(MAX_WINDOW + 1), { signedIn: true });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1][1]).toEqual({
      p_doctor_id: 'doc-1',
      p_from: '2027-01-02T00:00:00.000Z',
      p_to: '2027-01-02T00:00:00.001Z',
    });
  });

  it('makes no call and returns [] for an empty or negative range', async () => {
    const { fetchBookedRanges } = load();
    expect(await fetchBookedRanges('doc-1', FROM, FROM, { signedIn: true })).toEqual([]);
    expect(await fetchBookedRanges('doc-1', FROM, range(-DAY), { signedIn: true })).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('maps {scheduled_at, duration} rows to BookedRange and concatenates chunks in order', async () => {
    rpc
      .mockResolvedValueOnce({ data: [{ scheduled_at: '2026-11-05T09:00:00+00:00', duration: 30 }], error: null })
      .mockResolvedValueOnce({
        data: [
          { scheduled_at: '2027-01-10T14:00:00+00:00', duration: 45 },
          { scheduled_at: '2027-01-11T10:00:00+00:00', duration: 60 },
        ],
        error: null,
      });
    const result = await load().fetchBookedRanges('doc-1', FROM, range(90 * DAY), { signedIn: true });
    expect(result).toEqual([
      { start: new Date('2026-11-05T09:00:00.000Z'), end: new Date('2026-11-05T09:30:00.000Z') },
      { start: new Date('2027-01-10T14:00:00.000Z'), end: new Date('2027-01-10T14:45:00.000Z') },
      { start: new Date('2027-01-11T10:00:00.000Z'), end: new Date('2027-01-11T11:00:00.000Z') },
    ]);
  });

  it('defaults a null duration to 30 minutes (as before)', async () => {
    rpc.mockResolvedValueOnce({ data: [{ scheduled_at: '2026-11-05T09:00:00+00:00', duration: null }], error: null });
    const result = await load().fetchBookedRanges('doc-1', FROM, range(DAY), { signedIn: true });
    expect(result).toEqual([
      { start: new Date('2026-11-05T09:00:00.000Z'), end: new Date('2026-11-05T09:30:00.000Z') },
    ]);
  });

  it('never calls the RPC without a session and returns []', async () => {
    const { fetchBookedRanges } = load();
    expect(await fetchBookedRanges('doc-1', FROM, range(90 * DAY), { signedIn: false })).toEqual([]);
    expect(await fetchBookedRanges('doc-1', FROM, range(DAY))).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('treats SQLSTATE 42501 (not authenticated) as "no slots", without throwing', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(load().fetchBookedRanges('doc-1', FROM, range(DAY), { signedIn: true })).resolves.toEqual([]);
  });

  it('surfaces any other error (22023 range too long) by throwing it, as before', async () => {
    const error = { code: '22023', message: 'range too long' };
    rpc.mockResolvedValue({ data: null, error });
    await expect(load().fetchBookedRanges('doc-1', FROM, range(DAY), { signedIn: true })).rejects.toBe(error);
  });

  it('surfaces a network failure (rejected rpc) as well', async () => {
    rpc.mockRejectedValue(new Error('Network request failed'));
    await expect(load().fetchBookedRanges('doc-1', FROM, range(DAY), { signedIn: true })).rejects.toThrow(
      'Network request failed',
    );
  });

  it('getDaySlots: reads doctor_availability with the SESSION client and blocks a busy slot', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 10, 2, 8, 0)); // lundi 2 nov, 08:00 local
    const monday = new Date(2026, 10, 9); // lundi 9 nov (dayOfWeek 0, lundi = 0)
    sessionFrom.mockImplementation((table: string) =>
      table === 'doctor_availability'
        ? queryChain({
            data: [{ day_of_week: 0, start_time: '09:00:00', end_time: '10:00:00', valid_from: null, valid_to: null }],
            error: null,
          })
        : queryChain({ data: null, error: null }),
    );
    rpc.mockResolvedValue({
      data: [{ scheduled_at: new Date(2026, 10, 9, 9, 0).toISOString(), duration: 30 }],
      error: null,
    });

    const slots = await load().getDaySlots('doc-1', monday, { signedIn: true });

    expect(sessionFrom).toHaveBeenCalledWith('doctor_availability');
    expect(publicFrom).not.toHaveBeenCalled();
    expect(slots.map((s) => [s.start.getHours(), s.start.getMinutes(), s.available])).toEqual([
      [9, 0, false],
      [9, 30, true],
    ]);
  });

  it('getDaySlots / getMonthAvailability: visitors get nothing and trigger no query at all', async () => {
    const { getDaySlots, getMonthAvailability } = load();
    expect(await getDaySlots('doc-1', new Date(2026, 10, 9))).toEqual([]);
    expect(await getDaySlots('doc-1', new Date(2026, 10, 9), { signedIn: false })).toEqual([]);
    expect(await getMonthAvailability('doc-1', 2026, 11, { signedIn: false })).toEqual({});
    expect(sessionFrom).not.toHaveBeenCalled();
    expect(publicFrom).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('getMonthAvailability: signed-in reads go through the session client, never the anon one', async () => {
    await load().getMonthAvailability('doc-1', 2026, 11, { signedIn: true });
    const tables = sessionFrom.mock.calls.map(([t]) => t);
    expect(tables).toEqual(expect.arrayContaining(['doctor_availability', 'provider_scheduling_settings']));
    expect(publicFrom).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe('doctor_busy_slots');
  });

  it('no longer references the deprecated busy-times view anywhere in src/', () => {
    const { execSync } = require('child_process');
    const deprecatedView = ['consultation', 'busy', 'times'].join('_'); // pas de littéral : ce test ne doit pas se trouver lui-même
    const hits = execSync(
      `grep -rl "${deprecatedView}" src --include=*.ts --include=*.tsx || true`,
      { cwd: process.cwd() },
    )
      .toString()
      .trim();
    expect(hits).toBe('');
  });
});
