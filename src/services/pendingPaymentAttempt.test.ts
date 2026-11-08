import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearPendingAttempt,
  getPendingAttempt,
  listPendingAttempts,
  PENDING_ATTEMPT_MAX_AGE_MS,
  PENDING_PAYMENT_KEY,
  purgeStalePendingAttempts,
  savePendingAttempt,
} from './pendingPaymentAttempt';

const U = 'user-a';
const V = 'user-b';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

describe('pendingPaymentAttempt (AsyncStorage)', () => {
  it('stores { userId, consultationId, txnRef, payRef, at } under a namespaced key', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    await savePendingAttempt({ userId: U, consultationId: 'c1', txnRef: 'T1', payRef: 'P1' });
    expect(PENDING_PAYMENT_KEY).toBe('visiodoc.pendingConsultationPayments.v1');
    expect(await getPendingAttempt('c1', U)).toEqual({
      userId: U,
      consultationId: 'c1',
      txnRef: 'T1',
      payRef: 'P1',
      at: 1_800_000_000_000,
    });
    expect(await AsyncStorage.getAllKeys()).toEqual([PENDING_PAYMENT_KEY]);
  });

  it('keeps the original timestamp when only the payRef is added for the same txnRef; a new txnRef restarts the clock', async () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1000);
    await savePendingAttempt({ userId: U, consultationId: 'c1', txnRef: 'T1' });
    now.mockReturnValue(5000);
    await savePendingAttempt({ userId: U, consultationId: 'c1', txnRef: 'T1', payRef: 'P1' });
    expect((await getPendingAttempt('c1', U))?.at).toBe(1000);
    await savePendingAttempt({ userId: U, consultationId: 'c1', txnRef: 'T2' });
    expect(await getPendingAttempt('c1', U)).toEqual({ userId: U, consultationId: 'c1', txnRef: 'T2', at: 5000 });
  });

  it('holds one attempt per consultation, lists and clears them independently', async () => {
    await savePendingAttempt({ userId: U, consultationId: 'c1', txnRef: 'T1' });
    await savePendingAttempt({ userId: U, consultationId: 'c2', txnRef: 'T2' });
    expect((await listPendingAttempts(U)).map((a) => a.consultationId).sort()).toEqual(['c1', 'c2']);
    await clearPendingAttempt('c1', U);
    expect(await getPendingAttempt('c1', U)).toBeNull();
    expect(await getPendingAttempt('c2', U)).not.toBeNull();
  });

  it('tolerates corrupt storage', async () => {
    await AsyncStorage.setItem(PENDING_PAYMENT_KEY, '{not json');
    expect(await listPendingAttempts(U)).toEqual([]);
    await savePendingAttempt({ userId: U, consultationId: 'c1', txnRef: 'T1' });
    expect(await getPendingAttempt('c1', U)).not.toBeNull();
  });
});

describe('scoped to the signed-in user (no wipe on logout)', () => {
  it("user A's attempts are invisible to user B (get, list) and B cannot clear them", async () => {
    await savePendingAttempt({ userId: U, consultationId: 'c1', txnRef: 'T1', payRef: 'P1' });
    expect(await getPendingAttempt('c1', V)).toBeNull();
    expect(await listPendingAttempts(V)).toEqual([]);
    await clearPendingAttempt('c1', V);
    expect((await getPendingAttempt('c1', U))?.txnRef).toBe('T1'); // untouched
  });

  it("B's attempts do not hide or replace A's, and A still sees hers after B is gone (forced expiry + re-login)", async () => {
    await savePendingAttempt({ userId: U, consultationId: 'c1', txnRef: 'T1', payRef: 'P1' });
    await savePendingAttempt({ userId: V, consultationId: 'c2', txnRef: 'T2' });
    expect((await listPendingAttempts(U)).map((a) => a.consultationId)).toEqual(['c1']);
    expect((await listPendingAttempts(V)).map((a) => a.consultationId)).toEqual(['c2']);
    expect((await getPendingAttempt('c1', U))?.payRef).toBe('P1');
  });

  it('an attempt stored without a userId (legacy) is never exposed to anybody', async () => {
    await AsyncStorage.setItem(
      PENDING_PAYMENT_KEY,
      JSON.stringify({ c1: { consultationId: 'c1', txnRef: 'T1', payRef: 'P1', at: Date.now() } }),
    );
    expect(await listPendingAttempts(U)).toEqual([]);
    expect(await getPendingAttempt('c1', U)).toBeNull();
  });
});

describe('age purge never drops an attempt that carries a payRef', () => {
  it('purges txnRef-only attempts older than 24 h but keeps old payRef attempts forever', async () => {
    const now = jest.spyOn(Date, 'now');
    const t0 = 1_800_000_000_000;
    now.mockReturnValue(t0);
    await savePendingAttempt({ userId: U, consultationId: 'old-plain', txnRef: 'T-a' });
    await savePendingAttempt({ userId: U, consultationId: 'old-paid', txnRef: 'T-b', payRef: 'P-b' });
    now.mockReturnValue(t0 + PENDING_ATTEMPT_MAX_AGE_MS + 1);
    await savePendingAttempt({ userId: U, consultationId: 'fresh', txnRef: 'T-c' });
    expect((await listPendingAttempts(U)).map((a) => a.consultationId).sort()).toEqual(['fresh', 'old-paid']);
    expect(await getPendingAttempt('old-plain', U)).toBeNull(); // really removed from storage
    now.mockReturnValue(t0 + 400 * PENDING_ATTEMPT_MAX_AGE_MS);
    await purgeStalePendingAttempts();
    expect((await getPendingAttempt('old-paid', U))?.payRef).toBe('P-b');
  });

  it('purges across users (a stale txnRef-only attempt of someone else is dropped too)', async () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_800_000_000_000);
    await savePendingAttempt({ userId: V, consultationId: 'b-old', txnRef: 'T-x' });
    now.mockReturnValue(1_800_000_000_000 + PENDING_ATTEMPT_MAX_AGE_MS + 1);
    await purgeStalePendingAttempts();
    expect(JSON.parse((await AsyncStorage.getItem(PENDING_PAYMENT_KEY)) ?? '{}')).toEqual({});
  });
});

describe('store mutations are serialised', () => {
  it('concurrent save A + clear B + purge never loses A', async () => {
    const now = jest.spyOn(Date, 'now');
    const t0 = 1_800_000_000_000;
    now.mockReturnValue(t0);
    await savePendingAttempt({ userId: U, consultationId: 'B', txnRef: 'T-b' });
    now.mockReturnValue(t0 + PENDING_ATTEMPT_MAX_AGE_MS + 1);
    await Promise.all([
      savePendingAttempt({ userId: U, consultationId: 'A', txnRef: 'T-a', payRef: 'P-a' }),
      clearPendingAttempt('B', U),
      purgeStalePendingAttempts(),
      savePendingAttempt({ userId: U, consultationId: 'C', txnRef: 'T-c' }),
    ]);
    expect((await getPendingAttempt('A', U))?.payRef).toBe('P-a');
    expect(await getPendingAttempt('B', U)).toBeNull();
    expect(await getPendingAttempt('C', U)).not.toBeNull();
  });

  it('many concurrent saves all survive', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => savePendingAttempt({ userId: U, consultationId: `c${i}`, txnRef: `T${i}` })),
    );
    expect((await listPendingAttempts(U)).length).toBe(20);
  });

  it('a rejected operation does not poison the chain', async () => {
    const setItem = AsyncStorage.setItem as unknown as jest.Mock;
    const real = setItem.getMockImplementation() as (k: string, v: string) => Promise<void>;
    setItem.mockRejectedValueOnce(new Error('disk full'));
    await expect(savePendingAttempt({ userId: U, consultationId: 'c1', txnRef: 'T1' })).rejects.toThrow('disk full');
    setItem.mockImplementation(real);
    await savePendingAttempt({ userId: U, consultationId: 'c2', txnRef: 'T2' });
    expect(await getPendingAttempt('c2', U)).not.toBeNull();
  });
});
