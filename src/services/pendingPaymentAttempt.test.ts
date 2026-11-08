import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearPendingAttempt,
  getPendingAttempt,
  listPendingAttempts,
  PENDING_PAYMENT_KEY,
  savePendingAttempt,
} from './pendingPaymentAttempt';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

describe('pendingPaymentAttempt (AsyncStorage)', () => {
  it('stores { consultationId, txnRef, payRef, at } under a namespaced key', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    await savePendingAttempt({ consultationId: 'c1', txnRef: 'T1', payRef: 'P1' });
    expect(PENDING_PAYMENT_KEY).toBe('visiodoc.pendingConsultationPayments.v1');
    expect(await getPendingAttempt('c1')).toEqual({ consultationId: 'c1', txnRef: 'T1', payRef: 'P1', at: 1_800_000_000_000 });
    expect(await AsyncStorage.getAllKeys()).toEqual([PENDING_PAYMENT_KEY]);
  });

  it('keeps the original timestamp when only the payRef is added for the same txnRef; a new txnRef restarts the clock', async () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1000);
    await savePendingAttempt({ consultationId: 'c1', txnRef: 'T1' });
    now.mockReturnValue(5000);
    await savePendingAttempt({ consultationId: 'c1', txnRef: 'T1', payRef: 'P1' });
    expect((await getPendingAttempt('c1'))?.at).toBe(1000);
    await savePendingAttempt({ consultationId: 'c1', txnRef: 'T2' });
    expect(await getPendingAttempt('c1')).toEqual({ consultationId: 'c1', txnRef: 'T2', at: 5000 });
  });

  it('holds one attempt per consultation, lists and clears them independently', async () => {
    await savePendingAttempt({ consultationId: 'c1', txnRef: 'T1' });
    await savePendingAttempt({ consultationId: 'c2', txnRef: 'T2' });
    expect((await listPendingAttempts()).map((a) => a.consultationId).sort()).toEqual(['c1', 'c2']);
    await clearPendingAttempt('c1');
    expect(await getPendingAttempt('c1')).toBeNull();
    expect(await getPendingAttempt('c2')).not.toBeNull();
  });

  it('tolerates corrupt storage', async () => {
    await AsyncStorage.setItem(PENDING_PAYMENT_KEY, '{not json');
    expect(await listPendingAttempts()).toEqual([]);
    await savePendingAttempt({ consultationId: 'c1', txnRef: 'T1' });
    expect(await getPendingAttempt('c1')).not.toBeNull();
  });
});
