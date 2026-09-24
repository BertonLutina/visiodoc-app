import {
  DEFAULT_SETTINGS,
  computeDayStatus,
  effectiveRangesForDate,
  generateSlots,
  type BookedRange,
  type OverrideRule,
  type WeeklyRule,
} from './availabilityEngine';

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

describe('generateSlots', () => {
  const day = new Date(2026, 9, 15); // Thursday, arbitrary future date
  const now = new Date(2026, 9, 10, 8, 0); // 5 days before `day` — well within any horizon/notice

  it('generates one slot per interval for a simple range', () => {
    const slots = generateSlots(
      day,
      [{ startTime: '09:00', endTime: '10:00' }],
      { ...DEFAULT_SETTINGS, appointmentDurationMinutes: 30, slotIntervalMinutes: 30 },
      [],
      now,
    );
    expect(slots.map((s) => [s.start.getHours(), s.start.getMinutes(), s.available])).toEqual([
      [9, 0, true],
      [9, 30, true],
    ]);
  });

  it('duration and interval are independent: a 60min appointment can start every 30min', () => {
    const slots = generateSlots(
      day,
      [{ startTime: '09:00', endTime: '11:00' }],
      { ...DEFAULT_SETTINGS, appointmentDurationMinutes: 60, slotIntervalMinutes: 30 },
      [],
      now,
    );
    // starts: 09:00, 09:30, 10:00 (10:30 would end at 11:30, past the range end)
    expect(slots.map((s) => `${s.start.getHours()}:${s.start.getMinutes()}`)).toEqual([
      '9:0',
      '9:30',
      '10:0',
    ]);
  });

  it('marks a slot unavailable when it overlaps an existing booking', () => {
    const booked: BookedRange[] = [
      { start: new Date(2026, 9, 15, 9, 30), end: new Date(2026, 9, 15, 10, 0) },
    ];
    const slots = generateSlots(
      day,
      [{ startTime: '09:00', endTime: '10:30' }],
      { ...DEFAULT_SETTINGS, appointmentDurationMinutes: 30, slotIntervalMinutes: 30 },
      booked,
      now,
    );
    expect(slots.map((s) => s.available)).toEqual([true, false, true]); // 9:00, 9:30, 10:00
  });

  it('applies buffer before/after around existing bookings', () => {
    const booked: BookedRange[] = [
      { start: new Date(2026, 9, 15, 10, 0), end: new Date(2026, 9, 15, 10, 30) },
    ];
    const slots = generateSlots(
      day,
      [{ startTime: '09:00', endTime: '11:00' }],
      {
        ...DEFAULT_SETTINGS,
        appointmentDurationMinutes: 30,
        slotIntervalMinutes: 30,
        bufferBeforeMinutes: 15,
        bufferAfterMinutes: 15,
      },
      booked,
      now,
    );
    // booking occupies 10:00-10:30, buffered to 09:45-10:45.
    // 9:00 slot (9:00-9:30) does not overlap -> available.
    // 9:30 slot (9:30-10:00) overlaps buffered window (starts before 09:45 ends, ends after) -> unavailable.
    // 10:00 slot -> unavailable (the booking itself).
    // 10:30 slot (10:30-11:00) overlaps buffered window (10:30 < 10:45) -> unavailable.
    expect(slots.map((s) => s.available)).toEqual([true, false, false, false]);
  });

  it('excludes slots starting before now + minimum notice', () => {
    const today = new Date(2026, 9, 15, 8, 0);
    const slots = generateSlots(
      today,
      [{ startTime: '08:30', endTime: '11:00' }],
      { ...DEFAULT_SETTINGS, appointmentDurationMinutes: 30, slotIntervalMinutes: 30, minimumNoticeMinutes: 120 },
      [],
      today, // now = 08:00, so anything before 10:00 is excluded
    );
    expect(slots.map((s) => `${s.start.getHours()}:${s.start.getMinutes()}`)).toEqual(['10:0', '10:30']);
  });

  it('excludes dates in the past', () => {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const slots = generateSlots(
      yesterday,
      [{ startTime: '09:00', endTime: '10:00' }],
      DEFAULT_SETTINGS,
      [],
      now,
    );
    expect(slots).toEqual([]);
  });

  it('excludes dates beyond the booking horizon', () => {
    const farFuture = new Date(now);
    farFuture.setDate(farFuture.getDate() + DEFAULT_SETTINGS.bookingHorizonDays + 5);
    const slots = generateSlots(
      farFuture,
      [{ startTime: '09:00', endTime: '10:00' }],
      DEFAULT_SETTINGS,
      [],
      now,
    );
    expect(slots).toEqual([]);
  });

  it('a cancelled booking (absent from bookedRanges) frees the slot again', () => {
    const withBooking = generateSlots(
      day,
      [{ startTime: '09:00', endTime: '09:30' }],
      DEFAULT_SETTINGS,
      [{ start: new Date(2026, 9, 15, 9, 0), end: new Date(2026, 9, 15, 9, 30) }],
      now,
    );
    const afterCancellation = generateSlots(
      day,
      [{ startTime: '09:00', endTime: '09:30' }],
      DEFAULT_SETTINGS,
      [], // the cancelled booking is no longer in the active set
      now,
    );
    expect(withBooking[0].available).toBe(false);
    expect(afterCancellation[0].available).toBe(true);
  });
});

describe('computeDayStatus', () => {
  it('is "unavailable" when there are no slots at all', () => {
    expect(computeDayStatus([])).toBe('unavailable');
  });

  it('is "full" when every slot is taken', () => {
    const slots = [
      { start: new Date(), end: new Date(), available: false },
      { start: new Date(), end: new Date(), available: false },
    ];
    expect(computeDayStatus(slots)).toBe('full');
  });

  it('is "available" when at least one slot is free', () => {
    const slots = [
      { start: new Date(), end: new Date(), available: false },
      { start: new Date(), end: new Date(), available: true },
    ];
    expect(computeDayStatus(slots)).toBe('available');
  });
});
