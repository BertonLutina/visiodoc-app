import { canPayNow, PAY_WINDOW_MS } from './canPayNow';

const now = Date.UTC(2026, 10, 8, 12, 0, 0);
const base = { awaitingPayment: true, date: new Date(now + 86_400_000).toISOString() };

describe('canPayNow ("Payer maintenant" visibility)', () => {
  it('shown for a future pending_payment consultation created recently', () => {
    expect(canPayNow({ ...base, createdAt: new Date(now - 60_000).toISOString() }, now, false)).toBe(true);
  });
  it('hidden when not awaiting payment', () => {
    expect(canPayNow({ ...base, awaitingPayment: false }, now, false)).toBe(false);
  });
  it('hidden when the appointment time is in the past', () => {
    expect(canPayNow({ ...base, date: new Date(now - 1000).toISOString() }, now, true)).toBe(false);
  });
  it('hidden once the 15-minute server expiry has passed (created_at)', () => {
    const createdAt = new Date(now - PAY_WINDOW_MS - 1).toISOString();
    expect(PAY_WINDOW_MS).toBe(15 * 60_000);
    expect(canPayNow({ ...base, createdAt }, now, false)).toBe(false);
  });
  it('still shown past 15 min when a stored attempt exists (retry-confirm / explicit override must stay reachable)', () => {
    const createdAt = new Date(now - PAY_WINDOW_MS - 1).toISOString();
    expect(canPayNow({ ...base, createdAt }, now, true)).toBe(true);
  });
  it('without created_at only the past scheduled_at hides it', () => {
    expect(canPayNow(base, now, false)).toBe(true);
  });
});
