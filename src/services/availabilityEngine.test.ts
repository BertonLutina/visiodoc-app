import { effectiveRangesForDate, type OverrideRule, type WeeklyRule } from './availabilityEngine';

describe('effectiveRangesForDate', () => {
  // 2026-10-15 is a Thursday -> model dayOfWeek 3 (0=Lundi)
  const thursday = new Date(2026, 9, 15);

  it('returns the weekly ranges for that weekday when there is no override', () => {
    const weekly: WeeklyRule[] = [
      { dayOfWeek: 3, startTime: '09:00', endTime: '12:00' },
      { dayOfWeek: 3, startTime: '13:00', endTime: '17:00' },
      { dayOfWeek: 1, startTime: '08:00', endTime: '12:00' }, // different day, ignored
    ];
    const ranges = effectiveRangesForDate(thursday, weekly, []);
    expect(ranges).toEqual([
      { startTime: '09:00', endTime: '12:00' },
      { startTime: '13:00', endTime: '17:00' },
    ]);
  });

  it('returns an empty array for a weekday with no weekly rule', () => {
    const ranges = effectiveRangesForDate(thursday, [], []);
    expect(ranges).toEqual([]);
  });

  it('a custom-hours override replaces the weekly ranges entirely', () => {
    const weekly: WeeklyRule[] = [{ dayOfWeek: 3, startTime: '09:00', endTime: '17:00' }];
    const overrides: OverrideRule[] = [
      { date: '2026-10-15', isAvailable: true, startTime: '10:00', endTime: '13:00' },
    ];
    const ranges = effectiveRangesForDate(thursday, weekly, overrides);
    expect(ranges).toEqual([{ startTime: '10:00', endTime: '13:00' }]);
  });

  it('a full-day-unavailable override suppresses the weekly ranges entirely', () => {
    const weekly: WeeklyRule[] = [{ dayOfWeek: 3, startTime: '09:00', endTime: '17:00' }];
    const overrides: OverrideRule[] = [{ date: '2026-10-15', isAvailable: false }];
    const ranges = effectiveRangesForDate(thursday, weekly, overrides);
    expect(ranges).toEqual([]);
  });

  it('supports multiple override ranges the same day (lunch break)', () => {
    const overrides: OverrideRule[] = [
      { date: '2026-10-15', isAvailable: true, startTime: '08:00', endTime: '11:00' },
      { date: '2026-10-15', isAvailable: true, startTime: '15:00', endTime: '18:00' },
    ];
    const ranges = effectiveRangesForDate(thursday, [], overrides);
    expect(ranges).toEqual([
      { startTime: '08:00', endTime: '11:00' },
      { startTime: '15:00', endTime: '18:00' },
    ]);
  });

  it('ignores overrides for other dates', () => {
    const weekly: WeeklyRule[] = [{ dayOfWeek: 3, startTime: '09:00', endTime: '12:00' }];
    const overrides: OverrideRule[] = [{ date: '2026-10-16', isAvailable: false }];
    const ranges = effectiveRangesForDate(thursday, weekly, overrides);
    expect(ranges).toEqual([{ startTime: '09:00', endTime: '12:00' }]);
  });
});
