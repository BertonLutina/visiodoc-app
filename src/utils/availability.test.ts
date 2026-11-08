import {
  buildPeriodSlots,
  defaultPause,
  hasOverlappingRanges,
  isPauseInside,
  overridesForRemovedSlots,
  pauseTimeOptions,
  segmentsAfterPause,
  slotKey,
} from './availability';

describe('hasOverlappingRanges', () => {
  it('is false for non-overlapping ranges', () => {
    expect(
      hasOverlappingRanges([
        { start: '09:00', end: '12:00' },
        { start: '13:00', end: '17:00' },
      ]),
    ).toBe(false);
  });

  it('is false for a single range', () => {
    expect(hasOverlappingRanges([{ start: '09:00', end: '12:00' }])).toBe(false);
  });

  it('is false for back-to-back ranges that only touch at the boundary', () => {
    expect(
      hasOverlappingRanges([
        { start: '09:00', end: '12:00' },
        { start: '12:00', end: '17:00' },
      ]),
    ).toBe(false);
  });

  it('is true when one range starts before the previous one ends', () => {
    expect(
      hasOverlappingRanges([
        { start: '09:00', end: '12:00' },
        { start: '10:00', end: '14:00' },
      ]),
    ).toBe(true);
  });

  it('is true regardless of input order', () => {
    expect(
      hasOverlappingRanges([
        { start: '10:00', end: '14:00' },
        { start: '09:00', end: '12:00' },
      ]),
    ).toBe(true);
  });
});

describe('pause inside a range', () => {
  const range = { start: '09:00', end: '17:00', pause: { start: '12:00', minutes: 60 } };

  it('accepts a break fully inside the range', () => {
    expect(isPauseInside(range, range.pause)).toBe(true);
  });

  it('rejects a break that runs past the end of the range', () => {
    expect(isPauseInside(range, { start: '16:30', minutes: 60 })).toBe(false);
  });

  it('splits the range around the break and drops the paused hour', () => {
    expect(segmentsAfterPause(range)).toEqual([
      { start: '09:00', end: '12:00' },
      { start: '13:00', end: '17:00' },
    ]);
  });

  it('leaves the range intact when the break is missing or invalid', () => {
    expect(segmentsAfterPause({ ...range, pause: null })).toEqual([{ start: '09:00', end: '17:00' }]);
    expect(segmentsAfterPause({ ...range, pause: { start: '16:30', minutes: 60 } })).toEqual([
      { start: '09:00', end: '17:00' },
    ]);
  });

  it('offers quarter-hour break times strictly inside the range', () => {
    expect(pauseTimeOptions({ start: '09:00', end: '10:00' })).toEqual(['09:00', '09:15', '09:30', '09:45']);
  });

  it('suggests noon when it fits, otherwise a point inside the range', () => {
    expect(defaultPause({ start: '09:00', end: '17:00' })).toEqual({ start: '12:00', minutes: 60 });
    expect(defaultPause({ start: '14:00', end: '17:00' })).toEqual({ start: '15:30', minutes: 60 });
    expect(defaultPause({ start: '09:00', end: '09:10' })).toBeNull();
  });
});

describe('buildPeriodSlots', () => {
  const days = [
    { enabled: true, ranges: [{ start: '09:00', end: '17:00', pause: { start: '12:00', minutes: 60 } }] },
    { enabled: false, ranges: [{ start: '09:00', end: '17:00', pause: null }] },
    { enabled: false, ranges: [{ start: '09:00', end: '17:00', pause: null }] },
    { enabled: false, ranges: [{ start: '09:00', end: '17:00', pause: null }] },
    { enabled: false, ranges: [{ start: '09:00', end: '17:00', pause: null }] },
    { enabled: false, ranges: [{ start: '09:00', end: '17:00', pause: null }] },
    { enabled: false, ranges: [{ start: '09:00', end: '17:00', pause: null }] },
  ];

  it('repeats Monday hours on every Monday of the period and skips the break', () => {
    // 2026-10-05 and 2026-10-12 are Mondays. 2026-10-01 is a Thursday.
    const slots = buildPeriodSlots({
      periodStart: '2026-10-01',
      periodEnd: '2026-10-12',
      days,
      durationMinutes: 30,
      intervalMinutes: 30,
    });
    const dates = [...new Set(slots.map((s) => s.date))];
    expect(dates).toEqual(['2026-10-05', '2026-10-12']);
    const monday = slots.filter((s) => s.date === '2026-10-05').map((s) => s.start);
    expect(monday).toContain('09:00');
    expect(monday).toContain('11:30');
    expect(monday).not.toContain('12:00');
    expect(monday).not.toContain('12:30');
    expect(monday).toContain('13:00');
    expect(monday).toContain('16:30');
    expect(slots.find((s) => s.start === '09:00')).toMatchObject({ end: '09:30' });
  });

  it('returns nothing when the period is longer than three months', () => {
    expect(
      buildPeriodSlots({
        periodStart: '2026-01-01',
        periodEnd: '2026-06-01',
        days,
        durationMinutes: 30,
        intervalMinutes: 30,
      }),
    ).toEqual([]);
  });
});

describe('overridesForRemovedSlots', () => {
  const slots = [
    { date: '2026-10-05', dayOfWeek: 0, start: '09:00', end: '09:30' },
    { date: '2026-10-05', dayOfWeek: 0, start: '09:30', end: '10:00' },
    { date: '2026-10-05', dayOfWeek: 0, start: '10:00', end: '10:30' },
    { date: '2026-10-12', dayOfWeek: 0, start: '09:00', end: '09:30' },
  ];

  it('keeps a day untouched when none of its slots were removed', () => {
    expect(overridesForRemovedSlots(slots, new Set([slotKey('2026-10-05', '09:30')])).map((o) => o.date)).toEqual([
      '2026-10-05',
    ]);
  });

  it('stores the remaining slots of a day as separate ranges', () => {
    expect(overridesForRemovedSlots(slots, new Set([slotKey('2026-10-05', '09:30')]))).toEqual([
      {
        date: '2026-10-05',
        isAvailable: true,
        ranges: [
          { startTime: '09:00', endTime: '09:30' },
          { startTime: '10:00', endTime: '10:30' },
        ],
      },
    ]);
  });

  it('marks the day unavailable when every slot was removed', () => {
    const all = slots.filter((s) => s.date === '2026-10-05').map((s) => slotKey(s.date, s.start));
    expect(overridesForRemovedSlots(slots, new Set(all))[0]).toEqual({
      date: '2026-10-05',
      isAvailable: false,
      ranges: [],
    });
  });
});
