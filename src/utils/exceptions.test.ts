import { groupExceptions, periodDates, MAX_EXCEPTION_DAYS } from './exceptions';

const off = (date: string, reason?: string) => ({ date, isAvailable: false, ranges: [], reason });

describe('groupExceptions', () => {
  it('merges consecutive unavailable days with the same reason into one period', () => {
    const result = groupExceptions([off('2026-12-30', 'Vacances'), off('2026-12-31', 'Vacances'), off('2027-01-01', 'Vacances')]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'unavailable', start: '2026-12-30', end: '2027-01-01', reason: 'Vacances' });
    expect(result[0].dates).toEqual(['2026-12-30', '2026-12-31', '2027-01-01']);
  });

  it('keeps days apart when the reason differs or a day is missing', () => {
    expect(groupExceptions([off('2026-11-10', 'Congé'), off('2026-11-11', 'Formation')])).toHaveLength(2);
    expect(groupExceptions([off('2026-11-10'), off('2026-11-12')])).toHaveLength(2);
  });

  it('treats a blank reason as no reason', () => {
    const [entry] = groupExceptions([off('2026-11-10', '   ')]);
    expect(entry.reason).toBeNull();
  });

  it('lists custom-hours days on their own, sorted by date', () => {
    const result = groupExceptions([
      { date: '2026-11-20', isAvailable: true, ranges: [{ startTime: '08:00', endTime: '11:00' }] },
      off('2026-11-12', 'Congé'),
    ]);
    expect(result.map((e) => [e.kind, e.start])).toEqual([
      ['unavailable', '2026-11-12'],
      ['custom', '2026-11-20'],
    ]);
  });
});

describe('periodDates', () => {
  it('includes both bounds', () => {
    expect(periodDates('2026-11-28', '2026-12-02')).toEqual(['2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
  });

  it('returns nothing for an inverted or oversized period', () => {
    expect(periodDates('2026-12-02', '2026-11-28')).toEqual([]);
    expect(periodDates('2026-01-01', '2028-01-01')).toEqual([]);
    expect(MAX_EXCEPTION_DAYS).toBe(366);
  });
});
