# Disponibilités & réservation façon Calendly — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the weekly-only availability screen and unprotected booking flow with a full
recurring + override availability engine, a provider scheduling-settings screen, a patient month
calendar with day-slot selection, and DB-level double-booking protection.

**Architecture:** A pure TS engine (`src/services/availabilityEngine.ts`) computes effective
time ranges and bookable slots from weekly rules + date overrides + settings + existing
bookings, with zero I/O — testable without Supabase or React Native. A thin orchestration layer
(`src/services/availabilityApi.ts`) fetches the raw rows via the existing direct-Supabase-query
pattern and feeds the engine. Booking safety is enforced by two Postgres constraints
(`EXCLUDE` for overlaps, a partial unique index for one-booking-per-provider-per-day), not by
application code — the client catches the resulting Postgres error codes and shows a friendly
message.

**Tech Stack:** Expo Router, React Native, NativeWind, Supabase JS client, `jest` + `jest-expo`
(new — no test framework exists in this app today).

**Spec:** [docs/superpowers/specs/2026-09-24-scheduling-availability-design.md](../specs/2026-09-24-scheduling-availability-design.md)

## Global Constraints

- Single app timezone (`Africa/Kinshasa`, UTC+1, no DST) — no IANA/DST conversion logic in this
  iteration; all `Date` math uses device-local time, matching the app's current convention.
- No new backend/REST endpoints — all reads go through direct Supabase client queries
  (`supabase` / `supabasePublic`), matching `providerApi.ts`/`patientApi.ts` conventions.
- No new UI dependency — the month calendar is hand-rolled, matching the existing NativeWind +
  `colors` design system (no `react-native-calendars`).
- Reuse `doctor_availability` for both weekly rules and date overrides — no new table for
  overrides.
- Never expose another patient's identity or appointment details through the availability read
  path (month/day queries) — only `doctor_id`, `scheduled_at`, `duration` may be visible.
- `npm run typecheck` (`tsc --noEmit`) must pass after every task that touches `.ts`/`.tsx`.
- All new UI copy is hardcoded French, matching the app's existing convention (no i18n
  framework exists).
- Migration filenames use the `../supabase/migrations/` folder and a timestamp prefix later
  than the last existing file (`20260322222534_...`); this plan uses `20260924000000`,
  `20260924000001`, `20260924000002` in order.

## Review Focus

- **A provider saves weekly hours after already having date overrides** — must not delete the
  overrides (the old `saveAvailability` deleted *all* rows for the doctor; Task 8 scopes the
  delete to `recurrence_type = 'weekly'`, and its own test covers this).
- **Two patients tap "book" on the same slot within the same request round-trip** — the second
  `INSERT` must fail cleanly with a friendly message, not a generic error or a silent duplicate
  booking (Task 6 migration + Task 9 error mapping).
- **A provider marks a date "fully unavailable" while a weekly rule would otherwise show slots
  that day** — the override must fully suppress the weekly slots, not merge with them (Task 2
  test: override array with `isAvailable:false` and no times).
- **A slot passes the duration/interval math but starts before `now + minimumNoticeMinutes`**
  — must be excluded even on the current day where naive "future" checks would let it through
  (Task 3 test).
- **The month calendar is asked to render a month where the provider has zero rows at all**
  (new provider, nothing configured yet) — must show every day as `unavailable`, not crash or
  show `full` (Task 7 test: empty weekly rules + empty overrides).

---

## File Structure

New files:
- `src/services/availabilityEngine.ts` — pure logic (types, `effectiveRangesForDate`,
  `generateSlots`, `computeDayStatus`). No Supabase import. Fully unit-tested.
- `src/services/availabilityEngine.test.ts` — its tests.
- `src/services/availabilityApi.ts` — Supabase-backed orchestration (month/day availability,
  scheduling settings CRUD) built on top of the engine.
- `src/components/AvailabilityTabs.tsx` — shared 3-way segmented nav for the provider screens.
- `src/components/MonthCalendar.tsx` — hand-rolled month grid for the patient booking screen.
- `app/provider/availability-overrides.tsx` — date-override screen.
- `app/provider/scheduling-settings.tsx` — scheduling settings screen.
- `../supabase/migrations/20260924000000_extend_doctor_availability_for_overrides.sql`
- `../supabase/migrations/20260924000001_add_provider_scheduling_settings.sql`
- `../supabase/migrations/20260924000002_add_booking_safety_constraints.sql`
- `jest.config.js`

Modified files:
- `src/services/providerApi.ts` — weekly save scoped to `recurrence_type='weekly'`, override
  CRUD, scheduling-settings CRUD.
- `src/services/patientApi.ts` — `SlotUnavailableError`, `bookConsultation` maps Postgres error
  codes.
- `app/provider/availability.tsx` — multi-range-per-day UI, duration picker removed, tabs added.
- `app/doctor/[id].tsx` — `MonthCalendar` + day-slot list replace the old day-strip.
- `package.json` — `jest`, `jest-expo` devDependencies, `"test": "jest"` script.

---

### Task 1: Test infrastructure (`jest` + `jest-expo`)

**Files:**
- Modify: `package.json`
- Create: `jest.config.js`
- Create: `src/services/__smoke__.test.ts` (deleted again at the end of the task — only exists
  to prove the harness works before real tests depend on it)

**Interfaces:**
- Produces: `npm test` runs Jest; later tasks add real `*.test.ts` files under `src/`.

- [ ] **Step 1: Install jest-expo via the Expo CLI (resolves the SDK-57-compatible version automatically)**

Run: `npx expo install jest-expo --dev`

- [ ] **Step 2: Add the test script to `package.json`**

In the `"scripts"` block of `package.json`, add:
```json
    "test": "jest",
```
(placed right after `"typecheck": "tsc --noEmit",`)

- [ ] **Step 3: Create `jest.config.js`**

```js
module.exports = {
  preset: 'jest-expo',
  testPathIgnorePatterns: ['/node_modules/', '/.expo/'],
};
```

- [ ] **Step 4: Write a throwaway smoke test**

Create `src/services/__smoke__.test.ts`:
```ts
describe('jest harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run it**

Run: `npm test`
Expected: PASS (1 test, `jest harness > runs`)

- [ ] **Step 6: Delete the smoke test (its only job was to prove the harness works)**

Run: `rm src/services/__smoke__.test.ts`

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json jest.config.js
git commit -m "test: add jest + jest-expo test infrastructure"
```

---

### Task 2: `availabilityEngine.ts` — types + `effectiveRangesForDate`

**Files:**
- Create: `src/services/availabilityEngine.ts`
- Test: `src/services/availabilityEngine.test.ts`

**Interfaces:**
- Produces:
  - `WeeklyRule = { dayOfWeek: number; startTime: string; endTime: string }`
  - `OverrideRule = { date: string; isAvailable: boolean; startTime?: string; endTime?: string }`
  - `TimeRange = { startTime: string; endTime: string }`
  - `effectiveRangesForDate(date: Date, weeklyRules: WeeklyRule[], overrides: OverrideRule[]): TimeRange[]`

- [ ] **Step 1: Write the failing tests**

Create `src/services/availabilityEngine.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- availabilityEngine`
Expected: FAIL — `Cannot find module './availabilityEngine'`

- [ ] **Step 3: Write the implementation**

Create `src/services/availabilityEngine.ts`:
```ts
/**
 * Moteur de disponibilité — logique pure (aucun accès réseau/Supabase ici).
 * Convention de jour identique à src/utils/availability.ts : 0=Lundi … 6=Dimanche.
 */

export type WeeklyRule = { dayOfWeek: number; startTime: string; endTime: string };

export type OverrideRule = {
  date: string; // 'YYYY-MM-DD'
  isAvailable: boolean;
  startTime?: string;
  endTime?: string;
};

export type TimeRange = { startTime: string; endTime: string };

export type SchedulingSettings = {
  appointmentDurationMinutes: number;
  slotIntervalMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minimumNoticeMinutes: number;
  bookingHorizonDays: number;
};

export const DEFAULT_SETTINGS: SchedulingSettings = {
  appointmentDurationMinutes: 30,
  slotIntervalMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minimumNoticeMinutes: 120,
  bookingHorizonDays: 60,
};

export type BookedRange = { start: Date; end: Date };
export type Slot = { start: Date; end: Date; available: boolean };
export type DayStatus = 'available' | 'full' | 'unavailable';

const toMinutes = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

export const dateKey = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** JS Date.getDay() : 0=Dim … 6=Sam -> modèle 0=Lun … 6=Dim */
const jsDayToModel = (d: number) => (d + 6) % 7;

/**
 * Plages horaires effectives pour une date donnée : un override pour cette date
 * remplace ENTIÈREMENT la règle hebdomadaire (qu'il s'agisse d'horaires personnalisés
 * ou d'une indisponibilité totale).
 */
export function effectiveRangesForDate(
  date: Date,
  weeklyRules: WeeklyRule[],
  overrides: OverrideRule[],
): TimeRange[] {
  const key = dateKey(date);
  const dayOverrides = overrides.filter((o) => o.date === key);
  if (dayOverrides.length > 0) {
    return dayOverrides
      .filter((o) => o.isAvailable && o.startTime && o.endTime)
      .map((o) => ({ startTime: o.startTime as string, endTime: o.endTime as string }));
  }
  const model = jsDayToModel(date.getDay());
  return weeklyRules
    .filter((r) => r.dayOfWeek === model)
    .map((r) => ({ startTime: r.startTime, endTime: r.endTime }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- availabilityEngine`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/availabilityEngine.ts src/services/availabilityEngine.test.ts
git commit -m "feat: add availability engine effectiveRangesForDate with tests"
```

---

### Task 3: `availabilityEngine.ts` — `generateSlots` + `computeDayStatus`

**Files:**
- Modify: `src/services/availabilityEngine.ts`
- Modify: `src/services/availabilityEngine.test.ts`

**Interfaces:**
- Consumes: `TimeRange`, `SchedulingSettings`, `DEFAULT_SETTINGS`, `BookedRange`, `Slot`,
  `DayStatus` from Task 2.
- Produces:
  - `generateSlots(date: Date, ranges: TimeRange[], settings: SchedulingSettings, bookedRanges: BookedRange[], now: Date): Slot[]`
  - `computeDayStatus(slots: Slot[]): DayStatus`

- [ ] **Step 1: Write the failing tests**

Append to `src/services/availabilityEngine.test.ts`:
```ts
import { computeDayStatus, generateSlots, DEFAULT_SETTINGS } from './availabilityEngine';

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
    const booked: BookedRangeArg = [
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
    const booked: BookedRangeArg = [
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
      [{ startTime: '08, 30'.split(', ').join(':'), endTime: '11:00' } as any], // 08:30-11:00
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
```

Also add this import at the top of the test file (next to the existing ones):
```ts
import type { BookedRange as BookedRangeArg } from './availabilityEngine';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- availabilityEngine`
Expected: FAIL — `generateSlots`/`computeDayStatus` are not exported yet.

- [ ] **Step 3: Write the implementation**

Append to `src/services/availabilityEngine.ts`:
```ts
/**
 * Créneaux réservables pour une date donnée, à partir des plages effectives, des réglages
 * de réservation et des rendez-vous déjà pris. `now` est injecté (jamais `new Date()` en
 * interne) pour que la fonction reste pure et testable.
 */
export function generateSlots(
  date: Date,
  ranges: TimeRange[],
  settings: SchedulingSettings,
  bookedRanges: BookedRange[],
  now: Date,
): Slot[] {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  if (dayStart < todayStart) return [];

  const horizonEnd = new Date(todayStart);
  horizonEnd.setDate(horizonEnd.getDate() + settings.bookingHorizonDays);
  if (dayStart > horizonEnd) return [];

  const minStart = new Date(now.getTime() + settings.minimumNoticeMinutes * 60000);

  const slots: Slot[] = [];
  for (const range of ranges) {
    const rangeStartMin = toMinutes(range.startTime);
    const rangeEndMin = toMinutes(range.endTime);
    for (
      let m = rangeStartMin;
      m + settings.appointmentDurationMinutes <= rangeEndMin;
      m += settings.slotIntervalMinutes
    ) {
      const start = new Date(dayStart);
      start.setMinutes(m);
      const end = new Date(start.getTime() + settings.appointmentDurationMinutes * 60000);

      if (start < minStart) continue;

      const bufferedStart = new Date(start.getTime() - settings.bufferBeforeMinutes * 60000);
      const bufferedEnd = new Date(end.getTime() + settings.bufferAfterMinutes * 60000);
      const conflicts = bookedRanges.some((b) => bufferedStart < b.end && bufferedEnd > b.start);

      slots.push({ start, end, available: !conflicts });
    }
  }
  return slots.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** 'available' si au moins un créneau libre, 'full' si tout est pris, 'unavailable' si aucun créneau. */
export function computeDayStatus(slots: Slot[]): DayStatus {
  if (slots.length === 0) return 'unavailable';
  return slots.some((s) => s.available) ? 'available' : 'full';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- availabilityEngine`
Expected: PASS (all tests in the file — 15 total across both describe blocks from Task 2 and this task)

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/services/availabilityEngine.ts src/services/availabilityEngine.test.ts
git commit -m "feat: add generateSlots and computeDayStatus to availability engine"
```

---

### Task 4: Migration — extend `doctor_availability` for overrides

**Files:**
- Create: `../supabase/migrations/20260924000000_extend_doctor_availability_for_overrides.sql`

**Interfaces:**
- Produces: `doctor_availability.start_time`/`end_time` nullable; open SELECT policies for
  `authenticated` and `anon`.

- [ ] **Step 1: Write the migration**

```sql
-- Permet les overrides "indisponible toute la journée" (pas d'horaires),
-- et rend le planning d'un médecin lisible par tous (patients + anon) : sans ce
-- changement, une ligne d'override is_available=false serait invisible côté patient
-- et le moteur de créneaux afficherait à tort la règle hebdomadaire comme active.

ALTER TABLE doctor_availability
  ALTER COLUMN start_time DROP NOT NULL,
  ALTER COLUMN end_time DROP NOT NULL;
-- check_time_range (end_time > start_time) reste valide : NULL rend la comparaison
-- UNKNOWN, jamais FALSE, donc ne bloque pas l'insertion d'une ligne sans horaires.

DROP POLICY IF EXISTS "Patients can view available doctor slots" ON doctor_availability;
CREATE POLICY "Patients can view doctor availability"
  ON doctor_availability FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Public can view available doctor slots" ON doctor_availability;
CREATE POLICY "Public can view doctor availability"
  ON doctor_availability FOR SELECT
  TO anon
  USING (true);
```

- [ ] **Step 2: Commit**

```bash
git -C ../supabase add migrations/20260924000000_extend_doctor_availability_for_overrides.sql
git -C ../supabase commit -m "feat: nullable override hours + open read access on doctor_availability"
```

Note: this migration is written against the local (documented-stale) schema mirror. Do not run
`supabase db push` against the real project without first confirming these columns/policies
match live prod (see spec's "Points ouverts").

---

### Task 5: Migration — `provider_scheduling_settings` table

**Files:**
- Create: `../supabase/migrations/20260924000001_add_provider_scheduling_settings.sql`

**Interfaces:**
- Produces: table `provider_scheduling_settings(provider_id, appointment_duration_minutes,
  slot_interval_minutes, buffer_before_minutes, buffer_after_minutes, minimum_notice_minutes,
  booking_horizon_days, updated_at)`.

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE IF NOT EXISTS provider_scheduling_settings (
  provider_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  appointment_duration_minutes integer NOT NULL DEFAULT 30 CHECK (appointment_duration_minutes > 0),
  slot_interval_minutes integer NOT NULL DEFAULT 30 CHECK (slot_interval_minutes > 0),
  buffer_before_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_before_minutes >= 0),
  buffer_after_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_after_minutes >= 0),
  minimum_notice_minutes integer NOT NULL DEFAULT 120 CHECK (minimum_notice_minutes >= 0),
  booking_horizon_days integer NOT NULL DEFAULT 60 CHECK (booking_horizon_days > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE provider_scheduling_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Providers manage their own scheduling settings"
  ON provider_scheduling_settings FOR ALL
  TO authenticated
  USING (auth.uid() = provider_id)
  WITH CHECK (auth.uid() = provider_id);

-- Non sensible (juste des paramètres numériques) : lisible par tous pour que l'écran
-- patient (souvent en clé anon avant connexion) calcule les créneaux d'un médecin.
CREATE POLICY "Anyone can view scheduling settings"
  ON provider_scheduling_settings FOR SELECT
  TO anon, authenticated
  USING (true);
```

- [ ] **Step 2: Commit**

```bash
git -C ../supabase add migrations/20260924000001_add_provider_scheduling_settings.sql
git -C ../supabase commit -m "feat: add provider_scheduling_settings table"
```

---

### Task 6: Migration — booking safety constraints + busy-times view

**Files:**
- Create: `../supabase/migrations/20260924000002_add_booking_safety_constraints.sql`

**Interfaces:**
- Produces: `no_overlapping_bookings` EXCLUDE constraint, `one_booking_per_provider_per_day`
  unique index, `consultation_busy_times` view (columns: `doctor_id, scheduled_at, duration`).

- [ ] **Step 1: Write the migration**

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Empêche deux réservations actives qui se chevauchent pour le même médecin,
-- indépendamment de toute logique applicative (protège contre les races).
ALTER TABLE consultations
  ADD CONSTRAINT no_overlapping_bookings
  EXCLUDE USING gist (
    doctor_id WITH =,
    tstzrange(scheduled_at, scheduled_at + (duration || ' minutes')::interval, '[)') WITH &&
  ) WHERE (status NOT IN ('cancelled', 'no_show'));

-- Un même patient ne peut avoir qu'un seul rendez-vous actif par jour avec un même
-- médecin (des médecins différents le même jour restent autorisés).
CREATE UNIQUE INDEX one_booking_per_provider_per_day
  ON consultations (patient_id, doctor_id, ((scheduled_at AT TIME ZONE 'Africa/Kinshasa')::date))
  WHERE (status NOT IN ('cancelled', 'no_show'));

-- Vue publique exposant UNIQUEMENT les créneaux occupés d'un médecin (jamais l'identité
-- du patient ni aucune donnée médicale), pour que le calcul de disponibilité côté patient
-- (souvent en clé anon) sache qu'un créneau est pris sans lire consultations directement
-- (RLS de consultations restreint à patient_id = auth.uid() / doctor_id = auth.uid()).
CREATE VIEW consultation_busy_times AS
  SELECT doctor_id, scheduled_at, duration
  FROM consultations
  WHERE status NOT IN ('cancelled', 'no_show');

GRANT SELECT ON consultation_busy_times TO anon, authenticated;
```

- [ ] **Step 2: Commit**

```bash
git -C ../supabase add migrations/20260924000002_add_booking_safety_constraints.sql
git -C ../supabase commit -m "feat: add double-booking protection and busy-times view"
```

---

### Task 7: `availabilityApi.ts` — Supabase orchestration layer

**Files:**
- Create: `src/services/availabilityApi.ts`
- Test: `src/services/availabilityApi.test.ts`

**Interfaces:**
- Consumes: everything from Task 2/3 (`effectiveRangesForDate`, `generateSlots`,
  `computeDayStatus`, `DEFAULT_SETTINGS`, and the `WeeklyRule`/`OverrideRule`/
  `SchedulingSettings`/`BookedRange`/`Slot`/`DayStatus` types), plus `supabase`,
  `supabasePublic`, `supabaseConfigured` from `@/lib/supabase`.
- Produces:
  - `getSchedulingSettings(providerId: string): Promise<SchedulingSettings>`
  - `saveSchedulingSettings(providerId: string, settings: SchedulingSettings): Promise<void>`
  - `getMonthAvailability(providerId: string, year: number, month: number): Promise<Record<string, DayStatus>>`
  - `getDaySlots(providerId: string, date: Date): Promise<Slot[]>`

This task's own logic (`monthRange` day iteration wiring `effectiveRangesForDate` +
`generateSlots` + `computeDayStatus` together) is tested directly since it's pure once
the raw rows are passed in — the Supabase fetch functions themselves are thin pass-throughs
not worth mocking in this iteration (no test framework for network mocking exists yet, and
`useMock()`/RLS behavior is exercised manually in Task 16).

- [ ] **Step 1: Write the failing test for the pure month-iteration logic**

Create `src/services/availabilityApi.test.ts`:
```ts
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
    const now = new Date(2026, 9, 1, 8, 0);
    const weekly: WeeklyRule[] = [{ dayOfWeek: 3, startTime: '09:00', endTime: '10:00' }]; // Thursdays
    const result = buildMonthAvailability(2026, 10, weekly, [], DEFAULT_SETTINGS, [], now);
    // 2026-10-01 is a Thursday
    expect(result['2026-10-01']).toBe('available');
    expect(result['2026-10-02']).toBe('unavailable'); // Friday, no rule
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- availabilityApi`
Expected: FAIL — `Cannot find module './availabilityApi'`

- [ ] **Step 3: Write the implementation**

Create `src/services/availabilityApi.ts`:
```ts
import { supabase, supabasePublic, supabaseConfigured } from '@/lib/supabase';
import {
  DEFAULT_SETTINGS,
  computeDayStatus,
  dateKey,
  effectiveRangesForDate,
  generateSlots,
  type BookedRange,
  type DayStatus,
  type OverrideRule,
  type SchedulingSettings,
  type Slot,
  type WeeklyRule,
} from './availabilityEngine';

const useMock = () => !supabaseConfigured || !supabase;
const readClient = () => supabasePublic ?? supabase;

function monthBounds(year: number, month: number): { first: Date; last: Date } {
  return { first: new Date(year, month - 1, 1), last: new Date(year, month, 0) };
}

async function fetchWeeklyRules(providerId: string): Promise<WeeklyRule[]> {
  const client = readClient();
  if (!client) return [];
  const { data, error } = await client
    .from('doctor_availability')
    .select('day_of_week, start_time, end_time')
    .eq('doctor_id', providerId)
    .eq('recurrence_type', 'weekly')
    .eq('is_available', true);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    dayOfWeek: r.day_of_week,
    startTime: String(r.start_time).slice(0, 5),
    endTime: String(r.end_time).slice(0, 5),
  }));
}

async function fetchOverrides(providerId: string, from: Date, to: Date): Promise<OverrideRule[]> {
  const client = readClient();
  if (!client) return [];
  const { data, error } = await client
    .from('doctor_availability')
    .select('specific_date, start_time, end_time, is_available')
    .eq('doctor_id', providerId)
    .eq('recurrence_type', 'specific_date')
    .gte('specific_date', dateKey(from))
    .lte('specific_date', dateKey(to));
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    date: r.specific_date,
    isAvailable: r.is_available,
    startTime: r.start_time ? String(r.start_time).slice(0, 5) : undefined,
    endTime: r.end_time ? String(r.end_time).slice(0, 5) : undefined,
  }));
}

export async function getSchedulingSettings(providerId: string): Promise<SchedulingSettings> {
  if (useMock()) return DEFAULT_SETTINGS;
  const { data, error } = await supabase!
    .from('provider_scheduling_settings')
    .select('*')
    .eq('provider_id', providerId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_SETTINGS;
  return {
    appointmentDurationMinutes: data.appointment_duration_minutes,
    slotIntervalMinutes: data.slot_interval_minutes,
    bufferBeforeMinutes: data.buffer_before_minutes,
    bufferAfterMinutes: data.buffer_after_minutes,
    minimumNoticeMinutes: data.minimum_notice_minutes,
    bookingHorizonDays: data.booking_horizon_days,
  };
}

export async function saveSchedulingSettings(
  providerId: string,
  settings: SchedulingSettings,
): Promise<void> {
  if (useMock()) return;
  const { error } = await supabase!.from('provider_scheduling_settings').upsert({
    provider_id: providerId,
    appointment_duration_minutes: settings.appointmentDurationMinutes,
    slot_interval_minutes: settings.slotIntervalMinutes,
    buffer_before_minutes: settings.bufferBeforeMinutes,
    buffer_after_minutes: settings.bufferAfterMinutes,
    minimum_notice_minutes: settings.minimumNoticeMinutes,
    booking_horizon_days: settings.bookingHorizonDays,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

async function fetchBookedRanges(providerId: string, from: Date, to: Date): Promise<BookedRange[]> {
  const client = readClient();
  if (!client) return [];
  const { data, error } = await client
    .from('consultation_busy_times')
    .select('scheduled_at, duration')
    .eq('doctor_id', providerId)
    .gte('scheduled_at', from.toISOString())
    .lt('scheduled_at', to.toISOString());
  if (error) throw error;
  return (data ?? []).map((r: any) => {
    const start = new Date(r.scheduled_at);
    return { start, end: new Date(start.getTime() + (r.duration ?? 30) * 60000) };
  });
}

/**
 * Pure : construit le statut jour-par-jour du mois à partir des données déjà chargées.
 * Séparée de getMonthAvailability pour rester testable sans Supabase.
 */
export function buildMonthAvailability(
  year: number,
  month: number,
  weeklyRules: WeeklyRule[],
  overrides: OverrideRule[],
  settings: SchedulingSettings,
  bookedRanges: BookedRange[],
  now: Date,
): Record<string, DayStatus> {
  const { first, last } = monthBounds(year, month);
  const result: Record<string, DayStatus> = {};
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
    const date = new Date(d);
    const ranges = effectiveRangesForDate(date, weeklyRules, overrides);
    const slots = generateSlots(date, ranges, settings, bookedRanges, now);
    result[dateKey(date)] = computeDayStatus(slots);
  }
  return result;
}

export async function getMonthAvailability(
  providerId: string,
  year: number,
  month: number,
): Promise<Record<string, DayStatus>> {
  const { first, last } = monthBounds(year, month);
  const rangeEnd = new Date(last);
  rangeEnd.setDate(rangeEnd.getDate() + 1);

  const [weeklyRules, overrides, settings, bookedRanges] = await Promise.all([
    fetchWeeklyRules(providerId),
    fetchOverrides(providerId, first, last),
    getSchedulingSettings(providerId),
    fetchBookedRanges(providerId, first, rangeEnd),
  ]);

  return buildMonthAvailability(year, month, weeklyRules, overrides, settings, bookedRanges, new Date());
}

export async function getDaySlots(providerId: string, date: Date): Promise<Slot[]> {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const [weeklyRules, overrides, settings, bookedRanges] = await Promise.all([
    fetchWeeklyRules(providerId),
    fetchOverrides(providerId, dayStart, dayStart),
    getSchedulingSettings(providerId),
    fetchBookedRanges(providerId, dayStart, dayEnd),
  ]);

  const ranges = effectiveRangesForDate(dayStart, weeklyRules, overrides);
  return generateSlots(dayStart, ranges, settings, bookedRanges, new Date());
}
```

- [ ] **Step 4: Export `dateKey` from `availabilityEngine.ts` if not already exported**

It already is (added in Task 2). No change needed — just confirming the import in Step 3 resolves.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS (all suites — `availabilityEngine`, `availabilityApi`)

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/services/availabilityApi.ts src/services/availabilityApi.test.ts
git commit -m "feat: add availabilityApi orchestration layer (month/day availability, settings)"
```

---

### Task 8: `providerApi.ts` — weekly save scoping, override CRUD, settings CRUD

**Files:**
- Modify: `src/services/providerApi.ts`
- Test: `src/services/providerApi.test.ts` (only the pure grouping helper used by override CRUD
  parsing; the Supabase calls themselves are exercised manually in Task 16, same rationale as
  Task 7)

**Interfaces:**
- Consumes: `supabase`, `supabaseConfigured` from `@/lib/supabase` (already imported in this
  file).
- Produces:
  - `AvailabilityInput = { dayOfWeek: number; startTime: string; endTime: string }` (replaces
    the old shape — `slotDuration` removed, it's no longer read by the engine)
  - `saveAvailability(doctorId: string, ranges: AvailabilityInput[]): Promise<void>` — now only
    touches `recurrence_type='weekly'` rows
  - `OverrideInput = { date: string; isAvailable: boolean; ranges: { startTime: string; endTime: string }[] }`
  - `getOverrides(doctorId: string): Promise<OverrideInput[]>`
  - `saveOverride(doctorId: string, input: OverrideInput): Promise<void>`
  - `deleteOverride(doctorId: string, date: string): Promise<void>`
  - `groupOverrideRows(rows: { specific_date: string; start_time: string | null; end_time: string | null; is_available: boolean }[]): OverrideInput[]` (pure, exported for the test)
  - `getSchedulingSettings`/`saveSchedulingSettings` — re-exported from `availabilityApi.ts`
    (kept here too so provider screens only import from `providerApi`, matching this file's
    existing role as the provider-facing facade)

- [ ] **Step 1: Write the failing test for the pure row-grouping helper**

Create `src/services/providerApi.test.ts`:
```ts
import { groupOverrideRows } from './providerApi';

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- providerApi`
Expected: FAIL — `groupOverrideRows` is not exported yet.

- [ ] **Step 3: Write the implementation**

In `src/services/providerApi.ts`, replace the `/* ---------- Disponibilités ---------- */`
section (current lines 144-193) with:
```ts
/* ---------- Disponibilités hebdomadaires ---------- */
export async function getAvailability(doctorId: string): Promise<AvailabilitySlot[]> {
  if (useMock()) return mock.providerAvailability;
  const { data, error } = await supabase!
    .from('doctor_availability')
    .select('id, day_of_week, start_time, end_time')
    .eq('doctor_id', doctorId)
    .eq('recurrence_type', 'weekly')
    .eq('is_available', true)
    .order('day_of_week', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((a: any) => ({
    id: a.id,
    dayOfWeek: a.day_of_week ?? 0,
    startTime: a.start_time,
    endTime: a.end_time,
    slotDuration: 30, // vestige non lu par le nouveau moteur (voir provider_scheduling_settings)
    count: 0,
  }));
}

export type AvailabilityInput = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};

/** Remplace les disponibilités hebdomadaires du médecin (ne touche jamais aux overrides). */
export async function saveAvailability(
  doctorId: string,
  ranges: AvailabilityInput[],
): Promise<void> {
  if (useMock()) return; // mode mock : persistance locale côté écran (AsyncStorage)
  const { error: delErr } = await supabase!
    .from('doctor_availability')
    .delete()
    .eq('doctor_id', doctorId)
    .eq('recurrence_type', 'weekly');
  if (delErr) throw delErr;
  if (ranges.length === 0) return;
  const rows = ranges.map((r) => ({
    doctor_id: doctorId,
    recurrence_type: 'weekly',
    day_of_week: r.dayOfWeek,
    start_time: r.startTime,
    end_time: r.endTime,
    is_available: true,
  }));
  const { error } = await supabase!.from('doctor_availability').insert(rows);
  if (error) throw error;
}

/* ---------- Dates spécifiques (overrides) ---------- */
export type OverrideInput = {
  date: string; // 'YYYY-MM-DD'
  isAvailable: boolean;
  ranges: { startTime: string; endTime: string }[]; // vide si isAvailable=false
};

type OverrideRow = {
  specific_date: string;
  start_time: string | null;
  end_time: string | null;
  is_available: boolean;
};

/** Pure : regroupe les lignes DB (une par plage) en une entrée par date. */
export function groupOverrideRows(rows: OverrideRow[]): OverrideInput[] {
  const byDate = new Map<string, OverrideInput>();
  for (const r of rows) {
    if (!r.is_available) {
      byDate.set(r.specific_date, { date: r.specific_date, isAvailable: false, ranges: [] });
      continue;
    }
    const range = { startTime: (r.start_time ?? '').slice(0, 5), endTime: (r.end_time ?? '').slice(0, 5) };
    const existing = byDate.get(r.specific_date);
    if (existing && existing.isAvailable) existing.ranges.push(range);
    else byDate.set(r.specific_date, { date: r.specific_date, isAvailable: true, ranges: [range] });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function getOverrides(doctorId: string): Promise<OverrideInput[]> {
  if (useMock()) return [];
  const { data, error } = await supabase!
    .from('doctor_availability')
    .select('specific_date, start_time, end_time, is_available')
    .eq('doctor_id', doctorId)
    .eq('recurrence_type', 'specific_date')
    .order('specific_date', { ascending: true });
  if (error) throw error;
  return groupOverrideRows((data ?? []) as OverrideRow[]);
}

export async function saveOverride(doctorId: string, input: OverrideInput): Promise<void> {
  if (useMock()) return;
  const { error: delErr } = await supabase!
    .from('doctor_availability')
    .delete()
    .eq('doctor_id', doctorId)
    .eq('recurrence_type', 'specific_date')
    .eq('specific_date', input.date);
  if (delErr) throw delErr;

  const rows = input.isAvailable
    ? input.ranges.map((r) => ({
        doctor_id: doctorId,
        recurrence_type: 'specific_date',
        specific_date: input.date,
        day_of_week: null,
        start_time: r.startTime,
        end_time: r.endTime,
        is_available: true,
      }))
    : [
        {
          doctor_id: doctorId,
          recurrence_type: 'specific_date',
          specific_date: input.date,
          day_of_week: null,
          start_time: null,
          end_time: null,
          is_available: false,
        },
      ];
  const { error } = await supabase!.from('doctor_availability').insert(rows);
  if (error) throw error;
}

export async function deleteOverride(doctorId: string, date: string): Promise<void> {
  if (useMock()) return;
  const { error } = await supabase!
    .from('doctor_availability')
    .delete()
    .eq('doctor_id', doctorId)
    .eq('recurrence_type', 'specific_date')
    .eq('specific_date', date);
  if (error) throw error;
}

/* ---------- Réglages de réservation ---------- */
export { getSchedulingSettings, saveSchedulingSettings } from './availabilityApi';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- providerApi`
Expected: PASS (3 tests)

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors — check in particular that no other file still imports `slotDuration` as a
required field of `AvailabilityInput` (Task 11 updates the one caller, `app/provider/availability.tsx`).

- [ ] **Step 6: Commit**

```bash
git add src/services/providerApi.ts src/services/providerApi.test.ts
git commit -m "feat: scope weekly save to recurrence_type=weekly, add override CRUD to providerApi"
```

---

### Task 9: `patientApi.ts` — `SlotUnavailableError` + booking conflict mapping

**Files:**
- Modify: `src/services/patientApi.ts`
- Test: `src/services/patientApi.test.ts`

**Interfaces:**
- Produces:
  - `class SlotUnavailableError extends Error { reason: 'overlap' | 'daily-limit' }`
  - `bookConsultation` (existing signature unchanged) now throws `SlotUnavailableError` for
    Postgres codes `23P01`/`23505` instead of the raw Supabase error.

- [ ] **Step 1: Write the failing test**

Create `src/services/patientApi.test.ts`:
```ts
import { SlotUnavailableError } from './patientApi';

describe('SlotUnavailableError', () => {
  it('carries a friendly message for an overlap conflict', () => {
    const err = new SlotUnavailableError('overlap');
    expect(err.reason).toBe('overlap');
    expect(err.message).toMatch(/créneau/i);
    expect(err).toBeInstanceOf(Error);
  });

  it('carries a friendly message for the one-per-day conflict', () => {
    const err = new SlotUnavailableError('daily-limit');
    expect(err.reason).toBe('daily-limit');
    expect(err.message).toMatch(/déjà un rendez-vous/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- patientApi`
Expected: FAIL — `SlotUnavailableError` is not exported yet.

- [ ] **Step 3: Write the implementation**

In `src/services/patientApi.ts`, add this class above `bookConsultation` (currently starting at
line 129):
```ts
export class SlotUnavailableError extends Error {
  reason: 'overlap' | 'daily-limit';
  constructor(reason: 'overlap' | 'daily-limit') {
    super(
      reason === 'overlap'
        ? "Ce créneau vient d'être réservé, choisissez-en un autre."
        : 'Vous avez déjà un rendez-vous ce jour-là avec ce professionnel.',
    );
    this.name = 'SlotUnavailableError';
    this.reason = reason;
  }
}
```

Then replace the body of `bookConsultation` (lines 129-156) with:
```ts
export async function bookConsultation(input: {
  patientId: string;
  doctorId: string;
  scheduledAt: string;
  type: ConsultationType;
  fee: number;
}): Promise<{ id: string }> {
  if (useMock()) return { id: 'mock-booking' };
  const { data, error } = await supabase!
    .from('consultations')
    .insert({
      patient_id: input.patientId,
      doctor_id: input.doctorId,
      scheduled_at: input.scheduledAt,
      consultation_type: input.type,
      payment_amount: input.fee,
      status: 'pending',
      payment_status: 'pending',
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23P01') throw new SlotUnavailableError('overlap');
    if (error.code === '23505') throw new SlotUnavailableError('daily-limit');
    throw error;
  }
  // Paiement : Edge Function payment-initiate
  await supabase!.functions.invoke('payment-initiate', {
    body: { consultationId: data.id, amount: input.fee },
  });
  return { id: data.id };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- patientApi`
Expected: PASS (2 tests)

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/services/patientApi.ts src/services/patientApi.test.ts
git commit -m "feat: map booking conflict error codes to SlotUnavailableError"
```

---

### Task 10: `AvailabilityTabs` shared component

**Files:**
- Create: `src/components/AvailabilityTabs.tsx`

**Interfaces:**
- Produces: `AvailabilityTabs({ active }: { active: 'weekly' | 'overrides' | 'settings' })`

- [ ] **Step 1: Write the component**

```tsx
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';

const TABS = [
  { key: 'weekly', label: 'Hebdomadaire', href: '/provider/availability' },
  { key: 'overrides', label: 'Dates spécifiques', href: '/provider/availability-overrides' },
  { key: 'settings', label: 'Réglages', href: '/provider/scheduling-settings' },
] as const;

export function AvailabilityTabs({ active }: { active: (typeof TABS)[number]['key'] }) {
  return (
    <View className="flex-row bg-surface border border-line rounded-2xl p-1 mb-5">
      {TABS.map((t) => {
        const on = t.key === active;
        return (
          <Pressable
            key={t.key}
            onPress={() => {
              if (!on) router.replace(t.href as any);
            }}
            className={`flex-1 items-center py-2.5 rounded-xl ${on ? 'bg-accent' : ''}`}
          >
            <Text className={`font-sans-bold text-xs ${on ? 'text-white' : 'text-muted'}`}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/AvailabilityTabs.tsx
git commit -m "feat: add AvailabilityTabs shared segmented nav for provider screens"
```

---

### Task 11: `app/provider/availability.tsx` — multi-range weekly UI

**Files:**
- Modify: `app/provider/availability.tsx` (full rewrite of the state shape and save logic;
  the time-picker modal is reused as-is)

**Interfaces:**
- Consumes: `AvailabilityTabs` (Task 10), `getAvailability`/`saveAvailability` with the new
  `AvailabilityInput` shape (Task 8), `DAY_LABELS_LONG`/`TIME_OPTIONS`/`toMinutes` from
  `@/utils/availability` (unchanged).

- [ ] **Step 1: Replace the file**

Replace the full contents of `app/provider/availability.tsx` with:
```tsx
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChevronLeft, Clock, Plus, Trash2, X } from 'lucide-react-native';
import { Button } from '@/components/ui';
import { AvailabilityTabs } from '@/components/AvailabilityTabs';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { getAvailability, saveAvailability, type AvailabilityInput } from '@/services/providerApi';
import { currentProvider } from '@/data/mockProvider';
import { DAY_LABELS_LONG, TIME_OPTIONS, toMinutes } from '@/utils/availability';

type Range = { start: string; end: string };
type DayCfg = { enabled: boolean; ranges: Range[] };

const DEFAULT_DAYS: DayCfg[] = [
  { enabled: true, ranges: [{ start: '09:00', end: '17:00' }] }, // Lun
  { enabled: true, ranges: [{ start: '09:00', end: '17:00' }] }, // Mar
  { enabled: true, ranges: [{ start: '09:00', end: '17:00' }] }, // Mer
  { enabled: true, ranges: [{ start: '09:00', end: '17:00' }] }, // Jeu
  { enabled: true, ranges: [{ start: '09:00', end: '17:00' }] }, // Ven
  { enabled: false, ranges: [{ start: '09:00', end: '13:00' }] }, // Sam
  { enabled: false, ranges: [{ start: '09:00', end: '13:00' }] }, // Dim
];

export default function Availability() {
  const { user } = useAuth();
  const uid = user?.id ?? currentProvider.id;
  const storeKey = `visiodoc.availability.${uid}`;

  const [days, setDays] = useState<DayCfg[]>(DEFAULT_DAYS);
  const [picking, setPicking] = useState<{ day: number; range: number; which: 'start' | 'end' } | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'local'>('idle');

  useEffect(() => {
    let active = true;
    (async () => {
      const raw = await AsyncStorage.getItem(storeKey);
      if (active && raw) {
        try {
          const v = JSON.parse(raw);
          if (v.days) setDays(v.days);
        } catch {
          /* ignore */
        }
      }
      try {
        const remote = await getAvailability(uid);
        if (active && remote.length) {
          const next = DEFAULT_DAYS.map((d) => ({ ...d, enabled: false, ranges: [] as Range[] }));
          for (const r of remote) {
            if (!next[r.dayOfWeek]) continue;
            next[r.dayOfWeek].enabled = true;
            next[r.dayOfWeek].ranges.push({ start: r.startTime?.slice(0, 5), end: r.endTime?.slice(0, 5) });
          }
          for (const d of next) if (d.ranges.length === 0) d.ranges = [{ start: '09:00', end: '17:00' }];
          setDays(next);
        }
      } catch {
        /* lecture serveur indisponible → on garde le local */
      }
    })();
    return () => {
      active = false;
    };
  }, [uid]);

  const setDay = (i: number, patch: Partial<DayCfg>) =>
    setDays((d) => d.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  const setRange = (day: number, range: number, patch: Partial<Range>) =>
    setDays((d) =>
      d.map((x, idx) =>
        idx === day ? { ...x, ranges: x.ranges.map((r, ri) => (ri === range ? { ...r, ...patch } : r)) } : x,
      ),
    );

  const addRange = (day: number) =>
    setDays((d) =>
      d.map((x, idx) => (idx === day ? { ...x, ranges: [...x.ranges, { start: '14:00', end: '17:00' }] } : x)),
    );

  const removeRange = (day: number, range: number) =>
    setDays((d) =>
      d.map((x, idx) => (idx === day ? { ...x, ranges: x.ranges.filter((_, ri) => ri !== range) } : x)),
    );

  const onPickTime = (t: string) => {
    if (!picking) return;
    const r = days[picking.day].ranges[picking.range];
    if (picking.which === 'start') {
      const end = toMinutes(t) >= toMinutes(r.end) ? TIME_OPTIONS[Math.min(TIME_OPTIONS.indexOf(t) + 2, TIME_OPTIONS.length - 1)] : r.end;
      setRange(picking.day, picking.range, { start: t, end });
    } else {
      setRange(picking.day, picking.range, { end: t });
    }
    setPicking(null);
  };

  const onSave = async () => {
    setStatus('saving');
    const ranges: AvailabilityInput[] = days.flatMap((d, i) =>
      d.enabled ? d.ranges.map((r) => ({ dayOfWeek: i, startTime: r.start, endTime: r.end })) : [],
    );
    await AsyncStorage.setItem(storeKey, JSON.stringify({ days }));
    try {
      await saveAvailability(uid, ranges);
      setStatus('saved');
    } catch {
      setStatus('local');
    }
    setTimeout(() => setStatus('idle'), 3500);
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2">
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">Mes disponibilités</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 32 }}>
        <AvailabilityTabs active="weekly" />

        <Text className="font-sans text-sm text-muted mb-5 leading-5">
          Définissez vos heures de consultation par jour. Ajoutez plusieurs plages si vous avez
          une pause (ex. le midi).
        </Text>

        <Text className="font-sans-bold text-ink mb-3">Jours de la semaine</Text>
        {days.map((d, i) => (
          <View key={i} className="bg-surface rounded-3xl border border-line p-4 mb-3">
            <View className="flex-row items-center justify-between">
              <Text className="font-sans-bold text-ink text-base">{DAY_LABELS_LONG[i]}</Text>
              <Switch
                value={d.enabled}
                onValueChange={(v) => setDay(i, { enabled: v })}
                trackColor={{ false: colors.line, true: colors.accent }}
                thumbColor={colors.white}
                ios_backgroundColor={colors.line}
              />
            </View>
            {d.enabled ? (
              <View className="mt-3">
                {d.ranges.map((r, ri) => (
                  <View key={ri} className="flex-row items-center mb-2">
                    <Pressable
                      onPress={() => setPicking({ day: i, range: ri, which: 'start' })}
                      className="flex-1 flex-row items-center justify-center bg-bg rounded-2xl py-3 border border-line"
                    >
                      <Clock color={colors.muted} size={15} />
                      <Text className="font-sans-bold text-ink ml-2">{r.start}</Text>
                    </Pressable>
                    <Text className="font-sans text-muted mx-3">à</Text>
                    <Pressable
                      onPress={() => setPicking({ day: i, range: ri, which: 'end' })}
                      className="flex-1 flex-row items-center justify-center bg-bg rounded-2xl py-3 border border-line"
                    >
                      <Clock color={colors.muted} size={15} />
                      <Text className="font-sans-bold text-ink ml-2">{r.end}</Text>
                    </Pressable>
                    {d.ranges.length > 1 ? (
                      <Pressable onPress={() => removeRange(i, ri)} className="ml-2 p-2" hitSlop={8}>
                        <Trash2 color={colors.danger} size={18} />
                      </Pressable>
                    ) : null}
                  </View>
                ))}
                <Pressable onPress={() => addRange(i)} className="flex-row items-center mt-1">
                  <Plus color={colors.accent} size={16} />
                  <Text className="font-sans-bold text-accent text-sm ml-1">Ajouter une plage</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ))}

        {status === 'saved' ? (
          <View className="bg-primary-50 rounded-2xl px-4 py-3 mt-2 mb-3">
            <Text className="font-sans-semibold text-sm text-primary-700 text-center">
              ✓ Disponibilités enregistrées
            </Text>
          </View>
        ) : status === 'local' ? (
          <View className="bg-sand rounded-2xl px-4 py-3 mt-2 mb-3">
            <Text className="font-sans-medium text-sm text-clay text-center">
              Enregistré sur cet appareil. La synchronisation serveur nécessite l'activation de la
              policy d'écriture (voir admin).
            </Text>
          </View>
        ) : null}

        <Button
          label="Enregistrer mes disponibilités"
          variant="accent"
          loading={status === 'saving'}
          onPress={onSave}
          className="mt-2"
        />
      </ScrollView>

      <Modal visible={!!picking} animationType="slide" transparent onRequestClose={() => setPicking(null)}>
        <Pressable className="flex-1 bg-black/40 justify-end" onPress={() => setPicking(null)}>
          <Pressable className="bg-bg rounded-t-3xl" style={{ maxHeight: '70%' }} onPress={() => {}}>
            <View className="flex-row items-center justify-between px-5 pt-4 pb-2">
              <Text className="font-serif-bold text-xl text-ink">
                {picking?.which === 'start' ? 'Heure de début' : 'Heure de fin'}
              </Text>
              <Pressable onPress={() => setPicking(null)} hitSlop={10} className="p-1">
                <X color={colors.ink} size={22} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }}>
              {TIME_OPTIONS.filter((t) => {
                if (!picking) return true;
                if (picking.which === 'end') return toMinutes(t) > toMinutes(days[picking.day].ranges[picking.range].start);
                return true;
              }).map((t) => {
                const active =
                  picking &&
                  t ===
                    (picking.which === 'start'
                      ? days[picking.day].ranges[picking.range].start
                      : days[picking.day].ranges[picking.range].end);
                return (
                  <Pressable
                    key={t}
                    onPress={() => onPickTime(t)}
                    className={`py-3.5 px-4 rounded-2xl mb-1.5 ${active ? 'bg-accent' : 'bg-surface border border-line'}`}
                  >
                    <Text className={`font-sans-bold text-center ${active ? 'text-white' : 'text-ink'}`}>{t}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/provider/availability.tsx
git commit -m "feat: support multiple time ranges per day in weekly availability screen"
```

---

### Task 12: `MonthCalendar` component

**Files:**
- Create: `src/components/MonthCalendar.tsx`

**Interfaces:**
- Consumes: `DayStatus` from `@/services/availabilityEngine` (Task 2), `DAY_LABELS` from
  `@/utils/availability` (existing export).
- Produces:
  ```ts
  MonthCalendar(props: {
    year: number;
    month: number; // 1-12
    monthStatus: Record<string, DayStatus>;
    selectedDate: string | null;
    onSelectDate: (key: string) => void;
    onChangeMonth: (year: number, month: number) => void;
    minDate: Date;
    maxDate: Date;
    loading?: boolean;
  })
  ```

Built now (ahead of the patient screen it's ultimately for) because Task 13's provider
override screen also needs it as a date picker.

- [ ] **Step 1: Write the component**

```tsx
import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { DAY_LABELS } from '@/utils/availability';
import type { DayStatus } from '@/services/availabilityEngine';

const MONTH_LABELS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function MonthCalendar({
  year,
  month,
  monthStatus,
  selectedDate,
  onSelectDate,
  onChangeMonth,
  minDate,
  maxDate,
  loading = false,
}: {
  year: number;
  month: number;
  monthStatus: Record<string, DayStatus>;
  selectedDate: string | null;
  onSelectDate: (key: string) => void;
  onChangeMonth: (year: number, month: number) => void;
  minDate: Date;
  maxDate: Date;
  loading?: boolean;
}) {
  const cells = useMemo(() => {
    const first = new Date(year, month - 1, 1);
    const startOffset = (first.getDay() + 6) % 7; // 0 = Lundi
    const daysInMonth = new Date(year, month, 0).getDate();
    const out: (Date | null)[] = Array(startOffset).fill(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(new Date(year, month - 1, d));
    return out;
  }, [year, month]);

  const todayKey = dateKey(new Date());
  const minDateOnly = useMemo(() => {
    const d = new Date(minDate);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [minDate]);
  const maxDateOnly = useMemo(() => {
    const d = new Date(maxDate);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [maxDate]);

  return (
    <View>
      <View className="flex-row items-center justify-between mb-3">
        <Pressable
          onPress={() => onChangeMonth(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1)}
          className="p-2"
          hitSlop={8}
        >
          <ChevronLeft color={colors.ink} size={20} />
        </Pressable>
        <Text className="font-sans-bold text-ink text-base">
          {MONTH_LABELS[month - 1]} {year}
        </Text>
        <Pressable
          onPress={() => onChangeMonth(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1)}
          className="p-2"
          hitSlop={8}
        >
          <ChevronRight color={colors.ink} size={20} />
        </Pressable>
      </View>

      <View className="flex-row mb-1">
        {DAY_LABELS.map((l) => (
          <View key={l} style={{ width: `${100 / 7}%` }} className="items-center">
            <Text className="font-sans-medium text-xs text-muted">{l}</Text>
          </View>
        ))}
      </View>

      <View className="flex-row flex-wrap">
        {cells.map((date, i) => {
          if (!date) {
            return <View key={`empty-${i}`} style={{ width: `${100 / 7}%` }} className="py-1.5" />;
          }
          const key = dateKey(date);
          const status = monthStatus[key];
          const dateOnly = new Date(date);
          dateOnly.setHours(0, 0, 0, 0);
          const outOfRange = dateOnly < minDateOnly || dateOnly > maxDateOnly;
          const disabled = outOfRange || !status || status === 'unavailable';
          const isSelected = key === selectedDate;
          const isToday = key === todayKey;

          const bg = isSelected ? colors.primary : status === 'full' ? colors.sand : 'transparent';
          const textColor = isSelected
            ? colors.white
            : disabled
              ? colors.line
              : status === 'available'
                ? colors.ink
                : colors.muted;

          return (
            <View key={key} style={{ width: `${100 / 7}%` }} className="items-center py-1.5">
              <Pressable
                onPress={() => !disabled && onSelectDate(key)}
                disabled={disabled}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: bg,
                  borderWidth: isToday && !isSelected ? 1 : 0,
                  borderColor: colors.primary,
                }}
                className="items-center justify-center"
              >
                <Text style={{ color: textColor }} className="font-sans-semibold text-sm">
                  {date.getDate()}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      {loading ? <Text className="font-sans text-xs text-muted text-center mt-2">Chargement…</Text> : null}
    </View>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/MonthCalendar.tsx
git commit -m "feat: add hand-rolled MonthCalendar component"
```

---

### Task 13: `app/provider/availability-overrides.tsx` — date-override screen

**Files:**
- Create: `app/provider/availability-overrides.tsx`

**Interfaces:**
- Consumes: `AvailabilityTabs` (Task 10), `getOverrides`/`saveOverride`/`deleteOverride` from
  `@/services/providerApi` (Task 8), `MonthCalendar` (Task 12) for date picking, `TIME_OPTIONS`/
  `toMinutes` from `@/utils/availability`. `getMonthAvailability` is NOT used here (this screen
  manages overrides directly, it doesn't need day-level slot computation).

- [ ] **Step 1: Write the screen**

```tsx
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Clock, Plus, Trash2, X } from 'lucide-react-native';
import { Modal } from 'react-native';
import { Button, Card } from '@/components/ui';
import { AvailabilityTabs } from '@/components/AvailabilityTabs';
import { MonthCalendar } from '@/components/MonthCalendar';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { currentProvider } from '@/data/mockProvider';
import { useAsync } from '@/hooks/useAsync';
import {
  getOverrides,
  saveOverride,
  deleteOverride,
  type OverrideInput,
} from '@/services/providerApi';
import { TIME_OPTIONS, toMinutes } from '@/utils/availability';
import type { DayStatus } from '@/services/availabilityEngine';

type Range = { start: string; end: string };

export default function AvailabilityOverrides() {
  const { user } = useAuth();
  const uid = user?.id ?? currentProvider.id;
  const today = new Date();

  const { data: overrides, loading, reload } = useAsync(() => getOverrides(uid), [uid]);

  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [unavailableAllDay, setUnavailableAllDay] = useState(false);
  const [ranges, setRanges] = useState<Range[]>([{ start: '09:00', end: '17:00' }]);
  const [picking, setPicking] = useState<{ range: number; which: 'start' | 'end' } | null>(null);
  const [saving, setSaving] = useState(false);

  const monthStatus: Record<string, DayStatus> = useMemo(() => {
    const m: Record<string, DayStatus> = {};
    for (const o of overrides ?? []) {
      m[o.date] = o.isAvailable ? 'available' : 'unavailable';
    }
    return m;
  }, [overrides]);

  const maxDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3650);
    return d;
  }, []);

  const onSelectDate = (key: string) => {
    setSelectedDate(key);
    const existing = (overrides ?? []).find((o) => o.date === key);
    if (existing) {
      setUnavailableAllDay(!existing.isAvailable);
      setRanges(existing.isAvailable && existing.ranges.length ? existing.ranges.map((r) => ({ start: r.startTime, end: r.endTime })) : [{ start: '09:00', end: '17:00' }]);
    } else {
      setUnavailableAllDay(false);
      setRanges([{ start: '09:00', end: '17:00' }]);
    }
  };

  const addRange = () => setRanges((r) => [...r, { start: '14:00', end: '17:00' }]);
  const removeRange = (i: number) => setRanges((r) => r.filter((_, ri) => ri !== i));
  const setRange = (i: number, patch: Partial<Range>) =>
    setRanges((r) => r.map((x, ri) => (ri === i ? { ...x, ...patch } : x)));

  const onPickTime = (t: string) => {
    if (!picking) return;
    const r = ranges[picking.range];
    if (picking.which === 'start') {
      const end = toMinutes(t) >= toMinutes(r.end) ? TIME_OPTIONS[Math.min(TIME_OPTIONS.indexOf(t) + 2, TIME_OPTIONS.length - 1)] : r.end;
      setRange(picking.range, { start: t, end });
    } else {
      setRange(picking.range, { end: t });
    }
    setPicking(null);
  };

  const onSave = async () => {
    if (!selectedDate) return;
    setSaving(true);
    const input: OverrideInput = {
      date: selectedDate,
      isAvailable: !unavailableAllDay,
      ranges: unavailableAllDay ? [] : ranges.map((r) => ({ startTime: r.start, endTime: r.end })),
    };
    try {
      await saveOverride(uid, input);
      await reload();
      setSelectedDate(null);
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? "Impossible d'enregistrer cette date.");
    } finally {
      setSaving(false);
    }
  };

  const onRestore = async () => {
    if (!selectedDate) return;
    setSaving(true);
    try {
      await deleteOverride(uid, selectedDate);
      await reload();
      setSelectedDate(null);
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? 'Impossible de restaurer cette date.');
    } finally {
      setSaving(false);
    }
  };

  const hasExistingOverride = !!(overrides ?? []).find((o) => o.date === selectedDate);

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2">
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">Dates spécifiques</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 32 }}>
        <AvailabilityTabs active="overrides" />

        <Text className="font-sans text-sm text-muted mb-5 leading-5">
          Choisissez une date pour la marquer indisponible ou lui donner des horaires différents
          de votre planning habituel.
        </Text>

        <MonthCalendar
          year={year}
          month={month}
          monthStatus={monthStatus}
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
          onChangeMonth={(y, m) => {
            setYear(y);
            setMonth(m);
          }}
          minDate={today}
          maxDate={maxDate}
          loading={loading}
        />

        {selectedDate ? (
          <Card className="mt-5">
            <Text className="font-sans-bold text-ink text-base mb-3">
              {new Date(selectedDate + 'T00:00:00').toLocaleDateString('fr-FR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </Text>

            <View className="flex-row items-center justify-between mb-3">
              <Text className="font-sans-medium text-ink">Indisponible toute la journée</Text>
              <Switch
                value={unavailableAllDay}
                onValueChange={setUnavailableAllDay}
                trackColor={{ false: colors.line, true: colors.danger }}
                thumbColor={colors.white}
              />
            </View>

            {!unavailableAllDay ? (
              <View>
                {ranges.map((r, ri) => (
                  <View key={ri} className="flex-row items-center mb-2">
                    <Pressable
                      onPress={() => setPicking({ range: ri, which: 'start' })}
                      className="flex-1 flex-row items-center justify-center bg-bg rounded-2xl py-3 border border-line"
                    >
                      <Clock color={colors.muted} size={15} />
                      <Text className="font-sans-bold text-ink ml-2">{r.start}</Text>
                    </Pressable>
                    <Text className="font-sans text-muted mx-3">à</Text>
                    <Pressable
                      onPress={() => setPicking({ range: ri, which: 'end' })}
                      className="flex-1 flex-row items-center justify-center bg-bg rounded-2xl py-3 border border-line"
                    >
                      <Clock color={colors.muted} size={15} />
                      <Text className="font-sans-bold text-ink ml-2">{r.end}</Text>
                    </Pressable>
                    {ranges.length > 1 ? (
                      <Pressable onPress={() => removeRange(ri)} className="ml-2 p-2" hitSlop={8}>
                        <Trash2 color={colors.danger} size={18} />
                      </Pressable>
                    ) : null}
                  </View>
                ))}
                <Pressable onPress={addRange} className="flex-row items-center mt-1 mb-1">
                  <Plus color={colors.accent} size={16} />
                  <Text className="font-sans-bold text-accent text-sm ml-1">Ajouter une plage</Text>
                </Pressable>
              </View>
            ) : null}

            <Button label="Enregistrer" onPress={onSave} loading={saving} className="mt-3" />
            {hasExistingOverride ? (
              <Button label="Restaurer l'horaire habituel" variant="outline" onPress={onRestore} loading={saving} className="mt-2" />
            ) : null}
          </Card>
        ) : null}
      </ScrollView>

      <Modal visible={!!picking} animationType="slide" transparent onRequestClose={() => setPicking(null)}>
        <Pressable className="flex-1 bg-black/40 justify-end" onPress={() => setPicking(null)}>
          <Pressable className="bg-bg rounded-t-3xl" style={{ maxHeight: '70%' }} onPress={() => {}}>
            <View className="flex-row items-center justify-between px-5 pt-4 pb-2">
              <Text className="font-serif-bold text-xl text-ink">
                {picking?.which === 'start' ? 'Heure de début' : 'Heure de fin'}
              </Text>
              <Pressable onPress={() => setPicking(null)} hitSlop={10} className="p-1">
                <X color={colors.ink} size={22} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }}>
              {TIME_OPTIONS.filter((t) => {
                if (!picking) return true;
                if (picking.which === 'end') return toMinutes(t) > toMinutes(ranges[picking.range].start);
                return true;
              }).map((t) => {
                const active = picking && t === (picking.which === 'start' ? ranges[picking.range].start : ranges[picking.range].end);
                return (
                  <Pressable
                    key={t}
                    onPress={() => onPickTime(t)}
                    className={`py-3.5 px-4 rounded-2xl mb-1.5 ${active ? 'bg-accent' : 'bg-surface border border-line'}`}
                  >
                    <Text className={`font-sans-bold text-center ${active ? 'text-white' : 'text-ink'}`}>{t}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no errors (will only pass once Task 14's `MonthCalendar` exists — if executing tasks
strictly in file order, do Task 14 first, then come back to this step)

- [ ] **Step 3: Commit**

```bash
git add app/provider/availability-overrides.tsx
git commit -m "feat: add date-specific availability override screen"
```

---

### Task 14: `app/provider/scheduling-settings.tsx` — scheduling settings screen

**Files:**
- Create: `app/provider/scheduling-settings.tsx`

**Interfaces:**
- Consumes: `AvailabilityTabs` (Task 10), `getSchedulingSettings`/`saveSchedulingSettings` from
  `@/services/providerApi` (re-exported in Task 8), `SchedulingSettings` type from
  `@/services/availabilityEngine`.

- [ ] **Step 1: Write the screen**

```tsx
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { Button, Card } from '@/components/ui';
import { AvailabilityTabs } from '@/components/AvailabilityTabs';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { currentProvider } from '@/data/mockProvider';
import { getSchedulingSettings, saveSchedulingSettings } from '@/services/providerApi';
import { DEFAULT_SETTINGS, type SchedulingSettings } from '@/services/availabilityEngine';

type FieldDef = {
  key: keyof SchedulingSettings;
  label: string;
  hint: string;
  options: number[];
  unit: string;
};

const FIELDS: FieldDef[] = [
  { key: 'appointmentDurationMinutes', label: 'Durée d\'un rendez-vous', hint: 'Temps réservé pour chaque consultation.', options: [15, 20, 30, 45, 60], unit: 'min' },
  { key: 'slotIntervalMinutes', label: 'Intervalle entre créneaux', hint: 'À quelle fréquence un nouveau créneau peut démarrer.', options: [10, 15, 20, 30, 60], unit: 'min' },
  { key: 'bufferBeforeMinutes', label: 'Tampon avant', hint: 'Temps de battement avant chaque rendez-vous.', options: [0, 5, 10, 15, 30], unit: 'min' },
  { key: 'bufferAfterMinutes', label: 'Tampon après', hint: 'Temps de battement après chaque rendez-vous.', options: [0, 5, 10, 15, 30], unit: 'min' },
  { key: 'minimumNoticeMinutes', label: 'Préavis minimum', hint: 'Délai minimum avant qu\'un patient puisse réserver.', options: [0, 30, 60, 120, 240, 1440], unit: 'min' },
  { key: 'bookingHorizonDays', label: 'Horizon de réservation', hint: 'Nombre de jours à l\'avance réservables.', options: [14, 30, 60, 90, 180], unit: 'jours' },
];

export default function SchedulingSettingsScreen() {
  const { user } = useAuth();
  const uid = user?.id ?? currentProvider.id;

  const [settings, setSettings] = useState<SchedulingSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    getSchedulingSettings(uid)
      .then((s) => active && setSettings(s))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [uid]);

  const onSave = async () => {
    setSaving(true);
    try {
      await saveSchedulingSettings(uid, settings);
      Alert.alert('Réglages enregistrés');
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? 'Impossible d\'enregistrer les réglages.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2">
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">Réglages de réservation</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 32 }}>
        <AvailabilityTabs active="settings" />

        {loading ? (
          <Text className="font-sans text-muted text-center mt-6">Chargement…</Text>
        ) : (
          <>
            {FIELDS.map((f) => (
              <Card key={f.key} className="mb-3">
                <Text className="font-sans-bold text-ink mb-1">{f.label}</Text>
                <Text className="font-sans text-xs text-muted mb-3">{f.hint}</Text>
                <View className="flex-row flex-wrap">
                  {f.options.map((opt) => {
                    const on = settings[f.key] === opt;
                    return (
                      <Pressable
                        key={opt}
                        onPress={() => setSettings((s) => ({ ...s, [f.key]: opt }))}
                        className={`px-4 py-2.5 rounded-2xl mr-2 mb-2 ${on ? 'bg-accent' : 'bg-bg border border-line'}`}
                      >
                        <Text className={`font-sans-bold text-sm ${on ? 'text-white' : 'text-ink'}`}>
                          {opt} {f.unit}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Card>
            ))}

            <Button label="Enregistrer les réglages" variant="accent" loading={saving} onPress={onSave} className="mt-2" />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/provider/scheduling-settings.tsx
git commit -m "feat: add scheduling settings screen (duration, interval, buffers, notice, horizon)"
```

---

### Task 15: `app/doctor/[id].tsx` — patient month calendar + day slots

**Files:**
- Modify: `app/doctor/[id].tsx` (full rewrite of the booking section)

**Interfaces:**
- Consumes: `MonthCalendar` (Task 12), `getMonthAvailability`/`getDaySlots` from
  `@/services/availabilityApi` (Task 7), `SlotUnavailableError` from `@/services/patientApi`
  (Task 9), `Slot`/`DayStatus` types from `@/services/availabilityEngine`.

- [ ] **Step 1: Replace the file**

Replace the full contents of `app/doctor/[id].tsx` with:
```tsx
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Video, MessageCircle, Phone, CalendarX } from 'lucide-react-native';
import { Avatar, Button, SectionTitle, Stars } from '@/components/ui';
import { MonthCalendar } from '@/components/MonthCalendar';
import { formatMoney } from '@/utils/format';
import { activeCountry } from '@/config/countries';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { bookConsultation, getDoctor, SlotUnavailableError } from '@/services/patientApi';
import { getDaySlots, getMonthAvailability } from '@/services/availabilityApi';
import { doctors } from '@/data/mock';
import type { ConsultationType } from '@/types';

const types: { key: ConsultationType; icon: typeof Video; label: string }[] = [
  { key: 'video', icon: Video, label: 'Vidéo' },
  { key: 'chat', icon: MessageCircle, label: 'Chat' },
  { key: 'phone', icon: Phone, label: 'Tél.' },
];

const timeLabel = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export default function DoctorProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { data: fetched } = useAsync(() => getDoctor(id), [id]);
  const doctor = fetched ?? doctors.find((d) => d.id === id) ?? doctors[0];

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [type, setType] = useState<ConsultationType>('video');
  const [booking, setBooking] = useState(false);

  const {
    data: monthStatus,
    loading: monthLoading,
    reload: reloadMonth,
  } = useAsync(() => getMonthAvailability(doctor.id, year, month), [doctor.id, year, month]);

  const {
    data: daySlots,
    loading: dayLoading,
    reload: reloadDay,
  } = useAsync(
    () => (selectedDate ? getDaySlots(doctor.id, new Date(selectedDate + 'T00:00:00')) : Promise.resolve([])),
    [doctor.id, selectedDate],
  );

  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + 3650); // le vrai horizon vient du statut jour-par-jour

  const activeSlot = (daySlots ?? []).find((s) => timeLabel(s.start) === time) ?? null;

  const onBook = async () => {
    if (!activeSlot) return;
    setBooking(true);
    try {
      await bookConsultation({
        patientId: user?.id ?? 'patient-1',
        doctorId: doctor.id,
        scheduledAt: activeSlot.start.toISOString(),
        type,
        fee: doctor.fee,
      });
      router.replace('/(patient)/appointments');
    } catch (e: any) {
      if (e instanceof SlotUnavailableError) {
        Alert.alert('Créneau indisponible', e.message);
        setTime(null);
        reloadDay();
        reloadMonth();
      } else {
        Alert.alert('Réservation impossible', e?.message ?? 'Réessayez plus tard.');
      }
    } finally {
      setBooking(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2">
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">Profil médecin</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
        <View className="items-center mb-6">
          <Avatar initials={doctor.initials} size={80} />
          <Text className="font-serif-bold text-2xl text-ink mt-3">
            Dr. {doctor.firstName} {doctor.lastName}
          </Text>
          <Text className="font-sans text-sm text-muted mt-0.5">
            {doctor.specialty} · {doctor.city}
          </Text>
          <View className="mt-2">
            <Stars rating={doctor.rating} />
          </View>
          <Text className="font-sans text-xs text-muted mt-1">{doctor.reviewsCount} avis</Text>
        </View>

        <View className="flex-row justify-between mb-6">
          {[
            { v: `${doctor.yearsOfExperience} ans`, l: 'Expérience' },
            { v: `${doctor.patientsCount}`, l: 'Patients' },
            { v: `${Math.round(doctor.fee / 1000)}k ${activeCountry.currency.symbol}`, l: 'Tarif' },
          ].map((s) => (
            <View key={s.l} className="flex-1 items-center bg-surface border border-line rounded-3xl py-4 mx-1">
              <Text className="font-serif-bold text-xl text-ink">{s.v}</Text>
              <Text className="font-sans text-xs text-muted mt-0.5">{s.l}</Text>
            </View>
          ))}
        </View>

        <SectionTitle>Choisir un créneau</SectionTitle>
        <MonthCalendar
          year={year}
          month={month}
          monthStatus={monthStatus ?? {}}
          selectedDate={selectedDate}
          onSelectDate={(key) => {
            setSelectedDate(key);
            setTime(null);
          }}
          onChangeMonth={(y, m) => {
            setYear(y);
            setMonth(m);
            setSelectedDate(null);
            setTime(null);
          }}
          minDate={today}
          maxDate={maxDate}
          loading={monthLoading}
        />

        {selectedDate ? (
          <View className="mt-4 mb-4">
            <Text className="font-sans-bold text-ink mb-3">
              {new Date(selectedDate + 'T00:00:00').toLocaleDateString('fr-FR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </Text>
            {dayLoading ? (
              <Text className="font-sans text-muted">Chargement des créneaux…</Text>
            ) : (daySlots ?? []).length === 0 ? (
              <View className="bg-surface border border-line rounded-3xl p-6 items-center">
                <View className="w-12 h-12 rounded-2xl bg-sand items-center justify-center mb-3">
                  <CalendarX color={colors.clay} size={22} />
                </View>
                <Text className="font-sans-semibold text-ink text-center">Aucun créneau ce jour-là</Text>
              </View>
            ) : (
              <View className="flex-row flex-wrap">
                {(daySlots ?? []).map((s) => {
                  const label = timeLabel(s.start);
                  const on = time === label;
                  return (
                    <Pressable
                      key={label}
                      disabled={!s.available}
                      onPress={() => setTime(label)}
                      className={`w-[31%] mr-[2.33%] py-3 rounded-2xl items-center mb-2 ${
                        !s.available ? 'bg-line' : on ? 'bg-primary' : 'bg-surface border border-line'
                      }`}
                    >
                      <Text
                        className={`font-sans-bold ${
                          !s.available ? 'text-muted' : on ? 'text-white' : 'text-ink'
                        }`}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        ) : null}

        <SectionTitle>Type de consultation</SectionTitle>
        <View className="flex-row justify-between mb-6">
          {types.map((t) => {
            const on = type === t.key;
            return (
              <Pressable
                key={t.key}
                onPress={() => setType(t.key)}
                className={`flex-1 items-center py-4 rounded-3xl mx-1 ${on ? 'bg-primary' : 'bg-surface border border-line'}`}
              >
                <t.icon color={on ? colors.white : colors.primary} size={22} />
                <Text className={`text-sm mt-1 font-sans-semibold ${on ? 'text-white' : 'text-ink'}`}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Button
          label={
            activeSlot && selectedDate
              ? `Réserver ${new Date(selectedDate + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' })} à ${timeLabel(activeSlot.start)} — ${formatMoney(doctor.fee)}`
              : `Réserver — ${formatMoney(doctor.fee)}`
          }
          disabled={!activeSlot}
          loading={booking}
          onPress={onBook}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/doctor/[id].tsx
git commit -m "feat: replace day-strip with month calendar + day-slot list on patient booking screen"
```

---

### Task 16: Cleanup, full verification pass

**Files:**
- Modify: `src/utils/availability.ts` (remove now-dead `generateBookableDays`, `countSlots`,
  `fromMinutes` if unused — check first)
- No new files.

- [ ] **Step 1: Confirm `generateBookableDays` has no remaining callers**

Run: `grep -rn "generateBookableDays" app src`
Expected: no matches (Task 15 removed the only caller)

- [ ] **Step 2: Confirm `countSlots` has no remaining callers**

Run: `grep -rn "countSlots" app src`
Expected: no matches (Task 11's rewrite dropped the per-day slot-count hint that used it)

- [ ] **Step 3: Remove the dead code from `src/utils/availability.ts`**

Delete the `generateBookableDays` function and its `DaySlots` type, and the `countSlots`
function, from `src/utils/availability.ts`. Keep `DAY_LABELS`, `DAY_LABELS_LONG`,
`jsDayToModel`, `TIME_OPTIONS`, `toMinutes`, `fromMinutes` — `fromMinutes` is used nowhere
after this cleanup either; confirm with `grep -rn "fromMinutes" app src` and remove it too if
the grep comes back empty (it's currently only used inside `generateBookableDays`, which is
being deleted, and inside `availabilityEngine.ts`'s own separate `fromMinutes`-equivalent
math is inlined, not imported from this file).

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: PASS — all suites (`availabilityEngine`, `availabilityApi`, `providerApi`,
`patientApi`)

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit the cleanup**

```bash
git add src/utils/availability.ts
git commit -m "chore: remove dead weekly-only slot-generation code superseded by availabilityEngine"
```

- [ ] **Step 7: Manual verification checklist (no RN component test infra exists — do this on
  a dev build or Expo Go, both patient and provider accounts)**

Provider side:
- [ ] `Profil → Disponibilités` opens the weekly screen with the 3-tab nav visible.
- [ ] Add a second time range to a day (e.g. 09:00–12:00 + 13:00–17:00), save, reload the
  screen — both ranges persist.
- [ ] Remove a range, save, reload — it's gone.
- [ ] Switch to "Dates spécifiques" tab, pick a future date, mark it fully unavailable, save —
  switching back to it later shows the toggle still on and "Restaurer l'horaire habituel"
  visible.
- [ ] On the same override screen, pick a different date, give it custom hours different from
  the weekly default, save.
- [ ] Switch to "Réglages", change appointment duration and slot interval to different values
  (e.g. 60min duration / 30min interval), save, reload — values persist.
- [ ] Delete an override via "Restaurer l'horaire habituel" — the date's patient-facing
  availability reverts to the weekly rule.

Patient side (as a different account, viewing the provider configured above):
- [ ] Doctor profile screen shows a month calendar (not the old horizontal day strip).
- [ ] The date marked fully unavailable above is not selectable (greyed, disabled).
- [ ] The date with custom hours shows exactly those hours as slots, not the weekly default.
- [ ] Navigate month forward/backward — status updates, loading indicator shows briefly.
- [ ] Select a day with the 60min-duration/30min-interval settings — slot start times are
  30 minutes apart and each slot is clearly 60 minutes long (verify by booking one and
  checking the confirmed appointment's duration server-side, if visible in the app; otherwise
  visually confirm slot count matches the expected overlap pattern).
- [ ] Book a slot — succeeds, redirects to appointments, the slot now shows as unavailable
  (grey, disabled) when returning to the same day.
- [ ] Attempt to book a second appointment the same day with the SAME provider — fails with
  "Vous avez déjà un rendez-vous ce jour-là avec ce professionnel."
- [ ] Book a second appointment the same day with a DIFFERENT provider — succeeds.
- [ ] From two devices/sessions (or two rapid taps), attempt to book the exact same slot —
  one succeeds, the other shows "Ce créneau vient d'être réservé, choisissez-en un autre." and
  the slot list refreshes to show it as taken.
- [ ] Past dates and dates beyond a small test `bookingHorizonDays` (temporarily set low, e.g.
  7, via the settings screen) are not selectable in the month view.
- [ ] Cancel a booked appointment (if a cancel action exists elsewhere in the app) and confirm
  the slot becomes bookable again on the day view.

- [ ] **Step 8: Note remaining out-of-scope items for the user**

No commit needed for this step — it's a reminder, not a code change. Confirm with the user
before closing out this plan:
- The migrations in `../supabase/migrations/` were written against the local (documented-stale)
  schema mirror, not the live prod project — they must be verified/adapted before being applied
  for real.
- Full IANA/DST timezone support, and the `status`/`consultation_type` CHECK-constraint
  mismatches, were explicitly deferred per the spec's Decisions table — not bugs introduced by
  this work, but not fixed by it either.
