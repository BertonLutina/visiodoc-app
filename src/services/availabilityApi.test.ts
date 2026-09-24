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
