import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  confirmConsultationPayment,
  generateTxnRef,
  payConsultation,
  payExistingConsultation,
  PAYMENT_ATTEMPT_STALE_MS,
  PaymentConfirmationError,
  PaymentNotPayableError,
  PaymentRegistrationError,
  reconcilePendingPayments,
  resolveDismissedAttempt,
  registerConsultationPayment,
  registerProviderPaymentAttempt,
  registerProviderPaymentWithRetry,
} from './paymentAttempt';
import {
  clearPendingAttempt,
  getPendingAttempt,
  listPendingAttempts,
  PENDING_ATTEMPT_MAX_AGE_MS,
  savePendingAttempt,
} from './pendingPaymentAttempt';
import { onSessionExpired } from './sessionExpiry';

const USER = 'user-patient-1';
const OTHER_USER = 'user-patient-2';
let mockCurrentUser: string | null = USER;
// Les tentatives sont rattachées à l'utilisateur connecté : les assertions lisent celles de USER.
const saveAttempt = (a: { consultationId: string; txnRef: string; payRef?: string; userId?: string }) =>
  savePendingAttempt({ userId: USER, ...a });
const getAttempt = (id: string, userId: string = USER) => getPendingAttempt(id, userId);
const listAttempts = (userId: string = USER) => listPendingAttempts(userId);
const clearAttempt = (id: string, userId: string = USER) => clearPendingAttempt(id, userId);

// Seule frontière simulée : `@/lib/supabase` (Edge Functions + garde-fou : aucune écriture directe).
const mockInvoke = jest.fn();
const mockFrom = jest.fn();
const mockRefresh = jest.fn();
const mockMaybeSingle = jest.fn();
const mockUpdate = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabaseConfigured: true,
  supabase: {
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    auth: {
      refreshSession: (...a: unknown[]) => mockRefresh(...a),
      getSession: async () => {
        if (mockCurrentUser === '__throw__') throw new Error('storage unavailable');
        return { data: { session: mockCurrentUser ? { user: { id: mockCurrentUser } } : null }, error: null };
      },
    },
    from: (...a: unknown[]) => mockFrom(...a),
  },
  supabasePublic: null,
}));

/** Erreur telle que la renvoie supabase-js : FunctionsHttpError avec la `Response` dans `context`. */
const httpError = (status: number, body: unknown) => ({
  name: 'FunctionsHttpError',
  message: 'Edge Function returned a non-2xx status code',
  context: new Response(JSON.stringify(body), { status }),
});

const networkError = {
  name: 'FunctionsFetchError',
  message: 'Failed to send a request to the Edge Function',
};

const CONSULT = '3f6b5c1e-0000-4000-8000-0000000000c1';
const TXN = 'TXN_1730745600000_ABC';
const PAY_REF = 'ISW_PAY_REF_987654';

const PAID_ROW = { data: { id: CONSULT, status: 'scheduled', payment_status: 'paid', scheduled_at: '2099-01-01T09:00:00Z' }, error: null };
const PENDING_ROW = { data: { id: CONSULT, status: 'pending_payment', payment_status: 'pending', scheduled_at: '2099-01-01T09:00:00Z' }, error: null };
const CANCELLED_ROW = { data: { id: CONSULT, status: 'cancelled', payment_status: 'pending', scheduled_at: '2099-01-01T09:00:00Z' }, error: null };

beforeEach(async () => {
  mockCurrentUser = USER;
  mockInvoke.mockReset();
  mockFrom.mockReset();
  mockRefresh.mockReset();
  mockMaybeSingle.mockReset();
  mockUpdate.mockReset();
  await AsyncStorage.clear();
  mockInvoke.mockResolvedValue({ data: { success: true }, error: null });
  mockRefresh.mockResolvedValue({ data: { session: {} }, error: null });
  mockMaybeSingle.mockResolvedValue(PAID_ROW);
  mockFrom.mockReturnValue({
    select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }),
    update: mockUpdate,
  });
});

afterEach(() => jest.restoreAllMocks());

describe('generateTxnRef', () => {
  it('is URL/provider safe, reasonably short and unique', () => {
    const refs = new Set(Array.from({ length: 200 }, () => generateTxnRef()));
    expect(refs.size).toBe(200);
    for (const ref of refs) {
      expect(ref).toMatch(/^VDC-\d{13}-[A-Z0-9]{7}$/);
      expect(ref.length).toBeLessThanOrEqual(30);
    }
  });
});

describe('registerConsultationPayment', () => {
  it('posts exactly { consultationId, txnRef, useWallet } to register-payment-attempt', async () => {
    await expect(registerConsultationPayment(CONSULT, TXN)).resolves.toBeUndefined();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('register-payment-attempt', {
      body: { consultationId: CONSULT, txnRef: TXN, useWallet: false },
    });
  });

  it('forwards useWallet = true', async () => {
    await registerConsultationPayment(CONSULT, TXN, true);
    expect(mockInvoke).toHaveBeenCalledWith('register-payment-attempt', {
      body: { consultationId: CONSULT, txnRef: TXN, useWallet: true },
    });
  });

  it.each(['NOT_PAYABLE', 'TXN_ALREADY_USED'] as const)(
    '200 { success:false, code:%s } throws PaymentNotPayableError',
    async (code) => {
      mockInvoke.mockResolvedValue({ data: { success: false, code }, error: null });
      const err = await registerConsultationPayment(CONSULT, TXN).catch((e) => e);
      expect(err).toBeInstanceOf(PaymentNotPayableError);
      expect(err.code).toBe(code);
    },
  );

  it.each(['NOT_PAYABLE', 'TXN_ALREADY_USED'] as const)(
    'HTTP 409 { code:%s } (FunctionsHttpError) throws PaymentNotPayableError',
    async (code) => {
      mockInvoke.mockResolvedValue({ data: null, error: httpError(409, { success: false, code }) });
      const err = await registerConsultationPayment(CONSULT, TXN).catch((e) => e);
      expect(err).toBeInstanceOf(PaymentNotPayableError);
      expect(err.code).toBe(code);
    },
  );

  it('a network error does not throw (payment continues, catch-up absent)', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: networkError });
    await expect(registerConsultationPayment(CONSULT, TXN)).resolves.toBeUndefined();
  });

  it('invoke rejecting (offline) does not throw either', async () => {
    mockInvoke.mockRejectedValue(new TypeError('Network request failed'));
    await expect(registerConsultationPayment(CONSULT, TXN)).resolves.toBeUndefined();
  });

  it.each([429, 503, 500, 502])('HTTP %s does not throw', async (status) => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(status, { error: 'busy' }) });
    await expect(registerConsultationPayment(CONSULT, TXN)).resolves.toBeUndefined();
  });

  it.each([400, 403, 404])('a definitive HTTP %s rejection blocks the payment (PaymentRegistrationError)', async (status) => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(status, { error: 'nope' }) });
    const err = await registerConsultationPayment(CONSULT, TXN).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentRegistrationError);
    expect(err.status).toBe(status);
    expect(err.message).toBe('nope');
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  describe('401 (expired access token)', () => {
    it('refreshes the session once and retries register once', async () => {
      mockInvoke
        .mockResolvedValueOnce({ data: null, error: httpError(401, { error: 'JWT expired' }) })
        .mockResolvedValueOnce({ data: { success: true }, error: null });
      await expect(registerConsultationPayment(CONSULT, TXN)).resolves.toBeUndefined();
      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(mockInvoke).toHaveBeenCalledTimes(2);
      expect(mockInvoke.mock.calls[1]).toEqual(mockInvoke.mock.calls[0]);
    });

    it('a second 401 after a successful refresh blocks (no third attempt, no second refresh)', async () => {
      mockInvoke.mockResolvedValue({ data: null, error: httpError(401, { error: 'Unauthorized' }) });
      const err = await registerConsultationPayment(CONSULT, TXN).catch((e) => e);
      expect(err).toBeInstanceOf(PaymentRegistrationError);
      expect(err.status).toBe(401);
      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });

    it('a failed refresh is a session expiry: reported, blocks with the reconnect message, no retry', async () => {
      mockInvoke.mockResolvedValue({ data: null, error: httpError(401, { error: 'JWT expired' }) });
      mockRefresh.mockResolvedValue({
        data: { session: null },
        error: { code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' },
      });
      const expired = jest.fn();
      const off = onSessionExpired(expired);
      const err = await registerConsultationPayment(CONSULT, TXN).catch((e) => e);
      off();
      expect(err).toBeInstanceOf(PaymentRegistrationError);
      expect(err.message).toBe('Ta session a expiré, reconnecte-toi.');
      expect(expired).toHaveBeenCalledTimes(1);
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    it('a refresh that throws is also treated as session expiry', async () => {
      mockInvoke.mockResolvedValue({ data: null, error: httpError(401, {}) });
      mockRefresh.mockRejectedValue(new Error('network down'));
      const err = await registerConsultationPayment(CONSULT, TXN).catch((e) => e);
      expect(err).toBeInstanceOf(PaymentRegistrationError);
      expect(err.message).toBe('Ta session a expiré, reconnecte-toi.');
    });
  });
});

describe('confirmConsultationPayment', () => {
  it('posts exactly { consultationId, txnRef, payRef, useWallet } to confirm-consultation-payment', async () => {
    mockInvoke.mockResolvedValue({
      data: { success: true, consultationId: CONSULT, paidByCard: 30000, paidByWallet: 0 },
      error: null,
    });
    await confirmConsultationPayment(CONSULT, TXN, PAY_REF);
    expect(mockInvoke).toHaveBeenCalledWith('confirm-consultation-payment', {
      body: { consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF, useWallet: false },
    });
  });

  it('forwards useWallet = true', async () => {
    await confirmConsultationPayment(CONSULT, TXN, PAY_REF, true);
    expect(mockInvoke).toHaveBeenCalledWith('confirm-consultation-payment', {
      body: { consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF, useWallet: true },
    });
  });

  it('throws PaymentConfirmationError when the server refuses or is unreachable', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(500, { error: 'boom' }) });
    await expect(confirmConsultationPayment(CONSULT, TXN, PAY_REF)).rejects.toBeInstanceOf(PaymentConfirmationError);
    mockInvoke.mockResolvedValue({ data: null, error: networkError });
    await expect(confirmConsultationPayment(CONSULT, TXN, PAY_REF)).rejects.toBeInstanceOf(PaymentConfirmationError);
    mockInvoke.mockResolvedValue({ data: { success: false }, error: null });
    await expect(confirmConsultationPayment(CONSULT, TXN, PAY_REF)).rejects.toBeInstanceOf(PaymentConfirmationError);
  });
});

describe('payConsultation (register → widget → confirm)', () => {
  const callNames = () => mockInvoke.mock.calls.map((c) => c[0]);

  it('registers BEFORE the widget opens, confirms AFTER success, with the same txnRef', async () => {
    const order: string[] = [];
    mockInvoke.mockImplementation(async (name: string) => {
      order.push(name);
      return { data: { success: true }, error: null };
    });
    const openPaymentWidget = jest.fn(async (txnRef: string) => {
      order.push(`widget:${txnRef}`);
      return { status: 'success' as const, payRef: PAY_REF };
    });

    const result = await payConsultation({ consultationId: CONSULT, openPaymentWidget });

    const txnRef = openPaymentWidget.mock.calls[0][0];
    expect(txnRef).toMatch(/^VDC-\d{13}-[A-Z0-9]{7}$/);
    expect(order).toEqual(['register-payment-attempt', `widget:${txnRef}`, 'confirm-consultation-payment']);
    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'register-payment-attempt', {
      body: { consultationId: CONSULT, txnRef, useWallet: false },
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'confirm-consultation-payment', {
      body: { consultationId: CONSULT, txnRef, payRef: PAY_REF, useWallet: false },
    });
    expect(result).toEqual({ status: 'confirmed', txnRef });
  });

  it('threads useWallet through both calls', async () => {
    const openPaymentWidget = jest.fn(async () => ({ status: 'success' as const, payRef: PAY_REF }));
    await payConsultation({ consultationId: CONSULT, openPaymentWidget, useWallet: true });
    expect(mockInvoke.mock.calls.map((c) => c[1].body.useWallet)).toEqual([true, true]);
  });

  it.each(['NOT_PAYABLE', 'TXN_ALREADY_USED'] as const)(
    '%s → throws, widget NOT opened, confirm not called',
    async (code) => {
      mockInvoke.mockResolvedValue({ data: { success: false, code }, error: null });
      const openPaymentWidget = jest.fn();
      await expect(payConsultation({ consultationId: CONSULT, openPaymentWidget })).rejects.toBeInstanceOf(
        PaymentNotPayableError,
      );
      expect(openPaymentWidget).not.toHaveBeenCalled();
      // NOT_PAYABLE : un seul register ; TXN_ALREADY_USED : un seul re-register avec une nouvelle txnRef.
      expect(callNames()).toEqual(
        code === 'NOT_PAYABLE'
          ? ['register-payment-attempt']
          : ['register-payment-attempt', 'register-payment-attempt'],
      );
    },
  );

  it.each([
    ['network error', { data: null, error: networkError }],
    ['429', { data: null, error: httpError(429, {}) }],
    ['503', { data: null, error: httpError(503, {}) }],
  ])('register %s does not throw: the widget opens and confirm follows', async (_label, registerResult) => {
    mockInvoke.mockImplementation(async (name: string) =>
      name === 'register-payment-attempt' ? registerResult : { data: { success: true }, error: null },
    );
    const openPaymentWidget = jest.fn(async () => ({ status: 'success' as const, payRef: PAY_REF }));
    await expect(payConsultation({ consultationId: CONSULT, openPaymentWidget })).resolves.toMatchObject({
      status: 'confirmed',
    });
    expect(openPaymentWidget).toHaveBeenCalledTimes(1);
    expect(callNames()).toEqual(['register-payment-attempt', 'confirm-consultation-payment']);
  });

  it('widget cancelled → confirm not called and the consultation is never written', async () => {
    const openPaymentWidget = jest.fn(async () => ({ status: 'cancelled' as const }));
    const result = await payConsultation({ consultationId: CONSULT, openPaymentWidget });
    expect(result.status).toBe('cancelled');
    expect(callNames()).toEqual(['register-payment-attempt']);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(await getAttempt(CONSULT)).toBeNull();
  });

  it('retrying generates a NEW txnRef for each attempt', async () => {
    const openPaymentWidget = jest.fn(async () => ({ status: 'cancelled' as const }));
    await payConsultation({ consultationId: CONSULT, openPaymentWidget });
    await payConsultation({ consultationId: CONSULT, openPaymentWidget });
    const [first, second] = openPaymentWidget.mock.calls.map((c: unknown[]) => c[0]);
    expect(first).not.toBe(second);
  });

  it('a widget that fails to launch propagates and leaves confirm uncalled', async () => {
    const openPaymentWidget = jest.fn().mockRejectedValue(new Error('widget down'));
    await expect(payConsultation({ consultationId: CONSULT, openPaymentWidget })).rejects.toThrow('widget down');
    expect(callNames()).toEqual(['register-payment-attempt']);
  });

  it('a failed confirmation surfaces PaymentConfirmationError (payment is not silently lost)', async () => {
    mockInvoke.mockImplementation(async (name: string) =>
      name === 'confirm-consultation-payment'
        ? { data: null, error: httpError(500, { error: 'boom' }) }
        : { data: { success: true }, error: null },
    );
    const openPaymentWidget = jest.fn(async () => ({ status: 'success' as const, payRef: PAY_REF }));
    await expect(payConsultation({ consultationId: CONSULT, openPaymentWidget })).rejects.toBeInstanceOf(
      PaymentConfirmationError,
    );
  });

  it('never sends payment_status, status, amount or currency in any payload', async () => {
    const openPaymentWidget = jest.fn(async () => ({ status: 'success' as const, payRef: PAY_REF }));
    await payConsultation({ consultationId: CONSULT, openPaymentWidget });
    for (const call of mockInvoke.mock.calls) {
      const body = call[1].body;
      expect(Object.keys(body).sort()).toEqual(
        call[0] === 'register-payment-attempt'
          ? ['consultationId', 'txnRef', 'useWallet']
          : ['consultationId', 'payRef', 'txnRef', 'useWallet'],
      );
      expect(JSON.stringify(body)).not.toMatch(/paid|scheduled|payment_status|payment_amount|currency/);
    }
  });
});


describe('TXN_ALREADY_USED: regenerate the txnRef ONCE', () => {
  const used = { data: { success: false, code: 'TXN_ALREADY_USED' }, error: null };

  it('re-registers with a NEW txnRef and opens the widget with that one', async () => {
    mockInvoke.mockResolvedValueOnce(used).mockResolvedValue({ data: { success: true }, error: null });
    const openPaymentWidget = jest.fn(async () => ({ status: 'cancelled' as const }));
    await payConsultation({ consultationId: CONSULT, openPaymentWidget });
    const registers = mockInvoke.mock.calls.filter((c) => c[0] === 'register-payment-attempt');
    expect(registers).toHaveLength(2);
    const [first, second] = registers.map((c) => c[1].body.txnRef);
    expect(first).not.toBe(second);
    expect(openPaymentWidget).toHaveBeenCalledWith(second);
  });

  it('a second TXN_ALREADY_USED blocks: widget not opened, no third register', async () => {
    mockInvoke.mockResolvedValue(used);
    const openPaymentWidget = jest.fn();
    const err = await payConsultation({ consultationId: CONSULT, openPaymentWidget }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentNotPayableError);
    expect(err.code).toBe('TXN_ALREADY_USED');
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(openPaymentWidget).not.toHaveBeenCalled();
  });

  it('NOT_PAYABLE is never retried', async () => {
    mockInvoke.mockResolvedValue({ data: { success: false, code: 'NOT_PAYABLE' }, error: null });
    const err = await payConsultation({ consultationId: CONSULT, openPaymentWidget: jest.fn() }).catch((e) => e);
    expect(err.code).toBe('NOT_PAYABLE');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });
});

describe('paid-but-unconfirmed protection (pending attempt persisted in AsyncStorage)', () => {
  const success = async () => ({ status: 'success' as const, payRef: PAY_REF });

  it('persists the txnRef alone (no payRef) as soon as the widget is opened', async () => {
    let seen: any;
    const openPaymentWidget = jest.fn(async (txnRef: string) => {
      seen = await getAttempt(CONSULT);
      expect(seen).toMatchObject({ consultationId: CONSULT, txnRef });
      return { status: 'cancelled' as const };
    });
    await payConsultation({ consultationId: CONSULT, openPaymentWidget });
    expect(seen.payRef).toBeUndefined();
    expect(typeof seen.at).toBe('number');
  });

  it('persists { txnRef, payRef } BEFORE confirm is called', async () => {
    let atConfirm: any;
    mockInvoke.mockImplementation(async (name: string) => {
      if (name === 'confirm-consultation-payment') atConfirm = await getAttempt(CONSULT);
      return { data: { success: true }, error: null };
    });
    await payConsultation({ consultationId: CONSULT, openPaymentWidget: success });
    expect(atConfirm).toMatchObject({ consultationId: CONSULT, payRef: PAY_REF });
  });

  it('clears it only after confirm succeeded AND the re-read row is paid', async () => {
    await payConsultation({ consultationId: CONSULT, openPaymentWidget: success });
    expect(mockFrom).toHaveBeenCalledWith('consultations');
    expect(await getAttempt(CONSULT)).toBeNull();
  });

  it('keeps it when confirm fails', async () => {
    mockInvoke.mockImplementation(async (name: string) =>
      name === 'confirm-consultation-payment'
        ? { data: null, error: networkError }
        : { data: { success: true }, error: null },
    );
    await expect(payConsultation({ consultationId: CONSULT, openPaymentWidget: success })).rejects.toBeInstanceOf(
      PaymentConfirmationError,
    );
    expect(await getAttempt(CONSULT)).toMatchObject({ payRef: PAY_REF });
  });

  it('keeps it (and surfaces PaymentConfirmationError) when confirm answered but the row is not paid', async () => {
    mockMaybeSingle.mockResolvedValue(PENDING_ROW);
    await expect(payConsultation({ consultationId: CONSULT, openPaymentWidget: success })).rejects.toBeInstanceOf(
      PaymentConfirmationError,
    );
    expect(await getAttempt(CONSULT)).toMatchObject({ payRef: PAY_REF });
  });

  it('keeps it when the re-read itself fails', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await expect(payConsultation({ consultationId: CONSULT, openPaymentWidget: success })).rejects.toBeInstanceOf(
      PaymentConfirmationError,
    );
    expect(await getAttempt(CONSULT)).not.toBeNull();
  });

  it('a paid_unconfirmed widget result (charged, no payRef) keeps the txnRef and says do not pay again', async () => {
    const err = await payConsultation({
      consultationId: CONSULT,
      openPaymentWidget: async () => ({ status: 'paid_unconfirmed' as const }),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentConfirmationError);
    expect(err.message).toBe('Paiement effectué, ne repaie pas. Nous vérifions ta transaction.');
    expect(mockInvoke.mock.calls.map((c) => c[0])).toEqual(['register-payment-attempt']);
    const stored = await getAttempt(CONSULT);
    expect(stored).toMatchObject({ consultationId: CONSULT });
    expect(stored?.payRef).toBeUndefined();
  });

  it('a widget that cannot launch clears the attempt (nothing was charged)', async () => {
    await expect(
      payConsultation({ consultationId: CONSULT, openPaymentWidget: jest.fn().mockRejectedValue(new Error('down')) }),
    ).rejects.toThrow('down');
    expect(await getAttempt(CONSULT)).toBeNull();
  });
});

describe('payExistingConsultation (re-read first, retry confirm before any new widget)', () => {
  const widget = () => jest.fn(async (_txnRef: string) => ({ status: 'cancelled' as const }));
  const names = () => mockInvoke.mock.calls.map((c) => c[0]);

  it('refuses to pay a consultation that is already paid/scheduled (and drops a stale attempt)', async () => {
    await saveAttempt({ consultationId: CONSULT, txnRef: TXN });
    const openPaymentWidget = widget();
    await expect(payExistingConsultation({ consultationId: CONSULT, openPaymentWidget })).resolves.toEqual({
      status: 'already_paid',
    });
    expect(openPaymentWidget).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(await getAttempt(CONSULT)).toBeNull();
  });

  it('refuses a consultation that is no longer pending_payment (cancelled) with NOT_PAYABLE', async () => {
    mockMaybeSingle.mockResolvedValue(CANCELLED_ROW);
    const openPaymentWidget = widget();
    const err = await payExistingConsultation({ consultationId: CONSULT, openPaymentWidget }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentNotPayableError);
    expect(err.code).toBe('NOT_PAYABLE');
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(openPaymentWidget).not.toHaveBeenCalled();
  });

  it('stored attempt WITH payRef: confirms again with the SAME txnRef/payRef, then re-reads; no new widget', async () => {
    await saveAttempt({ consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF });
    mockMaybeSingle.mockResolvedValueOnce(PENDING_ROW).mockResolvedValueOnce(PAID_ROW);
    const openPaymentWidget = widget();
    const result = await payExistingConsultation({ consultationId: CONSULT, openPaymentWidget });
    expect(result).toEqual({ status: 'confirmed', txnRef: TXN });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('confirm-consultation-payment', {
      body: { consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF, useWallet: false },
    });
    expect(openPaymentWidget).not.toHaveBeenCalled();
    expect(await getAttempt(CONSULT)).toBeNull();
  });

  it('stored attempt WITH payRef whose confirm still fails: error, no new widget, attempt kept', async () => {
    await saveAttempt({ consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF });
    mockMaybeSingle.mockResolvedValue(PENDING_ROW);
    mockInvoke.mockResolvedValue({ data: null, error: networkError });
    const openPaymentWidget = widget();
    await expect(payExistingConsultation({ consultationId: CONSULT, openPaymentWidget })).rejects.toBeInstanceOf(
      PaymentConfirmationError,
    );
    expect(openPaymentWidget).not.toHaveBeenCalled();
    expect(await getAttempt(CONSULT)).toMatchObject({ payRef: PAY_REF });
  });

  it('confirm answering NOT_PAYABLE ("handled") with the row STILL unpaid: no new widget, support-case error, attempt kept', async () => {
    await saveAttempt({ consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF });
    mockMaybeSingle.mockResolvedValue(PENDING_ROW);
    mockInvoke.mockImplementation(async (name: string) =>
      name === 'confirm-consultation-payment'
        ? { data: null, error: httpError(409, { success: false, code: 'NOT_PAYABLE' }) }
        : { data: { success: true }, error: null },
    );
    const openPaymentWidget = widget();
    const err = await payExistingConsultation({ consultationId: CONSULT, openPaymentWidget }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentConfirmationError);
    expect(err.message).toMatch(/support/);
    expect(openPaymentWidget).not.toHaveBeenCalled();
    expect(names()).toEqual(['confirm-consultation-payment']); // no register either
    expect(await getAttempt(CONSULT)).toMatchObject({ payRef: PAY_REF });
  });

  it('confirm answering NOT_PAYABLE but the re-read row is paid: confirmed and the attempt is cleared', async () => {
    await saveAttempt({ consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF });
    mockMaybeSingle.mockResolvedValueOnce(PENDING_ROW).mockResolvedValue(PAID_ROW);
    mockInvoke.mockResolvedValue({ data: null, error: httpError(409, { success: false, code: 'NOT_PAYABLE' }) });
    const openPaymentWidget = widget();
    await expect(payExistingConsultation({ consultationId: CONSULT, openPaymentWidget })).resolves.toEqual({
      status: 'confirmed',
      txnRef: TXN,
    });
    expect(openPaymentWidget).not.toHaveBeenCalled();
    expect(await getAttempt(CONSULT)).toBeNull();
  });

  it('stored attempt WITHOUT payRef (< 15 min): do not open a widget, say it is being verified', async () => {
    await saveAttempt({ consultationId: CONSULT, txnRef: TXN });
    mockMaybeSingle.mockResolvedValue(PENDING_ROW);
    const openPaymentWidget = widget();
    await expect(payExistingConsultation({ consultationId: CONSULT, openPaymentWidget })).resolves.toEqual({
      status: 'verifying',
      canOverride: false,
    });
    expect(openPaymentWidget).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('an explicit override is ignored before 15 minutes', async () => {
    await saveAttempt({ consultationId: CONSULT, txnRef: TXN });
    mockMaybeSingle.mockResolvedValue(PENDING_ROW);
    const openPaymentWidget = widget();
    const r = await payExistingConsultation({ consultationId: CONSULT, openPaymentWidget, override: true });
    expect(r).toEqual({ status: 'verifying', canOverride: false });
    expect(openPaymentWidget).not.toHaveBeenCalled();
  });

  it('after 15 minutes the user may override explicitly; without override it still only reports verifying', async () => {
    const t0 = 1_800_000_000_000;
    const now = jest.spyOn(Date, 'now').mockReturnValue(t0);
    await saveAttempt({ consultationId: CONSULT, txnRef: TXN });
    mockMaybeSingle.mockResolvedValue(PENDING_ROW);
    now.mockReturnValue(t0 + PAYMENT_ATTEMPT_STALE_MS + 1);
    const openPaymentWidget = widget();
    await expect(payExistingConsultation({ consultationId: CONSULT, openPaymentWidget })).resolves.toEqual({
      status: 'verifying',
      canOverride: true,
    });
    expect(openPaymentWidget).not.toHaveBeenCalled();
    const r = await payExistingConsultation({ consultationId: CONSULT, openPaymentWidget, override: true });
    expect(r.status).toBe('cancelled');
    expect(openPaymentWidget).toHaveBeenCalledTimes(1);
  });

  it('no stored attempt and a pending_payment row: plain retry with a new txnRef', async () => {
    mockMaybeSingle.mockResolvedValue(PENDING_ROW);
    const openPaymentWidget = widget();
    const r = await payExistingConsultation({ consultationId: CONSULT, openPaymentWidget });
    expect(r.status).toBe('cancelled');
    expect(names()).toEqual(['register-payment-attempt']);
  });
});

describe('reconcilePendingPayments (appointments screen focus)', () => {
  it('re-confirms a stored attempt WITH payRef using the same txnRef/payRef, then clears it once the row is paid', async () => {
    await saveAttempt({ consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF });
    mockMaybeSingle.mockResolvedValueOnce(PENDING_ROW).mockResolvedValueOnce(PAID_ROW);
    await reconcilePendingPayments();
    expect(mockInvoke).toHaveBeenCalledWith('confirm-consultation-payment', {
      body: { consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF, useWallet: false },
    });
    expect(await getAttempt(CONSULT)).toBeNull();
  });

  it('drops attempts whose row is already paid without confirming again', async () => {
    await saveAttempt({ consultationId: CONSULT, txnRef: TXN });
    await reconcilePendingPayments();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(await getAttempt(CONSULT)).toBeNull();
  });

  it('leaves an uncertain attempt (no payRef) on a pending row untouched and never confirms it', async () => {
    await saveAttempt({ consultationId: CONSULT, txnRef: TXN });
    mockMaybeSingle.mockResolvedValue(PENDING_ROW);
    await reconcilePendingPayments();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(await getAttempt(CONSULT)).toMatchObject({ txnRef: TXN });
  });

  it('never throws (a failing confirm keeps the attempt for the next focus)', async () => {
    await saveAttempt({ consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF });
    mockMaybeSingle.mockResolvedValue(PENDING_ROW);
    mockInvoke.mockResolvedValue({ data: null, error: networkError });
    await expect(reconcilePendingPayments()).resolves.toEqual([]);
    expect(await getAttempt(CONSULT)).toMatchObject({ payRef: PAY_REF });
  });
});


describe('widget dismissed (user left the screen / gateway returned / timeout): the attempt is KEPT', () => {
  const dismissed = (reason: 'user_left' | 'gateway_returned' | 'timeout') => async () => ({ status: 'dismissed' as const, reason });

  it.each(['user_left', 'gateway_returned', 'timeout'] as const)(
    '%s → no confirm, attempt (txnRef only) kept, result says dismissed with the reason',
    async (reason) => {
      const result = await payConsultation({ consultationId: CONSULT, openPaymentWidget: dismissed(reason) });
      expect(result).toMatchObject({ status: 'dismissed', reason });
      expect(mockInvoke.mock.calls.map((c) => c[0])).toEqual(['register-payment-attempt']);
      const stored = await getAttempt(CONSULT);
      expect(stored).toMatchObject({ consultationId: CONSULT, txnRef: (result as any).txnRef });
      expect(stored?.payRef).toBeUndefined();
    },
  );

  it('a gateway cancel (explicit) still clears the attempt', async () => {
    await payConsultation({ consultationId: CONSULT, openPaymentWidget: async () => ({ status: 'cancelled' as const }) });
    expect(await getAttempt(CONSULT)).toBeNull();
  });

  it('then "Payer maintenant" does NOT open a second widget: it reports verifying (no second charge)', async () => {
    await payConsultation({ consultationId: CONSULT, openPaymentWidget: dismissed('user_left') });
    mockMaybeSingle.mockResolvedValue(PENDING_ROW);
    mockInvoke.mockClear();
    const openPaymentWidget = jest.fn();
    await expect(payExistingConsultation({ consultationId: CONSULT, openPaymentWidget })).resolves.toEqual({
      status: 'verifying',
      canOverride: false,
    });
    expect(openPaymentWidget).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  describe('resolveDismissedAttempt ("Tu as été débité ?")', () => {
    it('Non → the attempt is cleared (the user can pay again)', async () => {
      await saveAttempt({ consultationId: CONSULT, txnRef: TXN });
      await resolveDismissedAttempt(CONSULT, false);
      expect(await getAttempt(CONSULT)).toBeNull();
    });
    it('Oui → the attempt is kept (verifying message, 15-minute override later)', async () => {
      await saveAttempt({ consultationId: CONSULT, txnRef: TXN });
      await resolveDismissedAttempt(CONSULT, true);
      expect(await getAttempt(CONSULT)).toMatchObject({ txnRef: TXN });
    });
  });
});

describe('in-flight guard per consultation (reconcile / pay / payExisting never run concurrently)', () => {
  it('a reconcile and a second payExisting started while a pay is in flight do nothing', async () => {
    mockMaybeSingle.mockResolvedValue(PENDING_ROW);
    let release!: (r: { status: 'cancelled' }) => void;
    const slowWidget = jest.fn(
      (_txnRef: string) => new Promise<{ status: 'cancelled' }>((resolve) => { release = resolve as unknown as typeof release; }),
    );
    const first = payExistingConsultation({ consultationId: CONSULT, openPaymentWidget: slowWidget });
    await new Promise<void>((r) => setImmediate(() => r())); // let the first call reach the widget
    expect(slowWidget).toHaveBeenCalledTimes(1);

    await saveAttempt({ consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF }); // would be re-confirmed if unguarded
    mockInvoke.mockClear();
    await reconcilePendingPayments();
    const secondWidget = jest.fn();
    await expect(payExistingConsultation({ consultationId: CONSULT, openPaymentWidget: secondWidget })).resolves.toEqual({
      status: 'verifying',
      canOverride: false,
    });
    await expect(payConsultation({ consultationId: CONSULT, openPaymentWidget: secondWidget })).rejects.toThrow(
      'Paiement en cours de vérification',
    );
    expect(secondWidget).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();

    release({ status: 'cancelled' });
    await first;
    // lock released: a later call goes through
    await clearAttempt(CONSULT);
    const third = await payExistingConsultation({
      consultationId: CONSULT,
      openPaymentWidget: async () => ({ status: 'cancelled' as const }),
    });
    expect(third.status).toBe('cancelled');
  });

  it('the lock is released even when the guarded call throws', async () => {
    mockMaybeSingle.mockResolvedValue(CANCELLED_ROW);
    await expect(
      payExistingConsultation({ consultationId: CONSULT, openPaymentWidget: jest.fn() }),
    ).rejects.toBeInstanceOf(PaymentNotPayableError);
    mockMaybeSingle.mockResolvedValue(PAID_ROW);
    await expect(
      payExistingConsultation({ consultationId: CONSULT, openPaymentWidget: jest.fn() }),
    ).resolves.toEqual({ status: 'already_paid' });
  });
});

describe('attempts are scoped to the signed-in user (no wipe on logout)', () => {
  it("user A's attempt is invisible to user B: B's reconcile never confirms it and B is never blocked by it", async () => {
    await saveAttempt({ consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF }); // stored for USER
    mockMaybeSingle.mockResolvedValue(PENDING_ROW);
    mockCurrentUser = OTHER_USER;
    await reconcilePendingPayments();
    expect(mockInvoke).not.toHaveBeenCalled();
    // B is not held in "verifying" by A's txnRef-only attempt either
    await clearAttempt(CONSULT);
    await saveAttempt({ consultationId: CONSULT, txnRef: TXN }); // A's uncertain attempt
    const openPaymentWidget = jest.fn(async (_t: string) => ({ status: 'cancelled' as const }));
    await expect(payExistingConsultation({ consultationId: CONSULT, openPaymentWidget })).resolves.toMatchObject({
      status: 'cancelled',
    });
    expect(openPaymentWidget).toHaveBeenCalledTimes(1);
  });

  it("every attempt is stored with the current user's id", async () => {
    const openPaymentWidget = async (_t: string) => ({ status: 'dismissed' as const, reason: 'user_left' as const });
    await payConsultation({ consultationId: CONSULT, openPaymentWidget });
    expect((await listAttempts(USER)).map((a) => a.userId)).toEqual([USER]);
    expect(await listAttempts(OTHER_USER)).toEqual([]);
  });

  it("A's attempt survives a forced session expiry (session gone) and is reconciled again after A logs back in", async () => {
    await saveAttempt({ consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF });
    mockMaybeSingle.mockResolvedValue(PENDING_ROW);
    mockCurrentUser = null; // JWT expired / forced sign-out: nothing is wiped
    await reconcilePendingPayments();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(await getAttempt(CONSULT)).not.toBeNull();
    mockCurrentUser = USER; // re-login
    mockMaybeSingle.mockResolvedValueOnce(PENDING_ROW).mockResolvedValue(PAID_ROW);
    await reconcilePendingPayments();
    expect(mockInvoke).toHaveBeenCalledWith('confirm-consultation-payment', {
      body: { consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF, useWallet: false },
    });
    expect(await getAttempt(CONSULT)).toBeNull();
  });
});

describe('paid attempt whose consultation is no longer payable: support case, nothing is purged or reopened', () => {
  const EXPIRED_ROW = { data: { id: CONSULT, status: 'expired', payment_status: 'pending', scheduled_at: '2099-01-01T09:00:00Z' }, error: null };

  it.each([['cancelled', CANCELLED_ROW], ['expired', EXPIRED_ROW]] as const)(
    'payExisting with a payRef attempt and a %s row: support error with the txnRef, no widget, no confirm, attempt kept',
    async (_name, row) => {
      await saveAttempt({ consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF });
      mockMaybeSingle.mockResolvedValue(row);
      const openPaymentWidget = jest.fn();
      const error = await payExistingConsultation({ consultationId: CONSULT, openPaymentWidget }).catch((e) => e);
      expect(error).toBeInstanceOf(PaymentConfirmationError);
      expect(error.message).toContain('contacte le support');
      expect(error.message).toContain(TXN);
      expect(openPaymentWidget).not.toHaveBeenCalled();
      expect(mockInvoke).not.toHaveBeenCalled();
      expect((await getAttempt(CONSULT))?.payRef).toBe(PAY_REF);
    },
  );

  it('payExisting with a payRef attempt whose row is not visible any more is a support case too', async () => {
    await saveAttempt({ consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF });
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(payExistingConsultation({ consultationId: CONSULT, openPaymentWidget: jest.fn() })).rejects.toBeInstanceOf(
      PaymentConfirmationError,
    );
    expect(await getAttempt(CONSULT)).not.toBeNull();
  });

  it('a txnRef-only attempt on a cancelled row still behaves as before (NOT_PAYABLE)', async () => {
    await saveAttempt({ consultationId: CONSULT, txnRef: TXN });
    mockMaybeSingle.mockResolvedValue(CANCELLED_ROW);
    await expect(payExistingConsultation({ consultationId: CONSULT, openPaymentWidget: jest.fn() })).rejects.toBeInstanceOf(
      PaymentNotPayableError,
    );
  });

  it('a payRef attempt is removed only when the row is re-read as paid / scheduled', async () => {
    await saveAttempt({ consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF });
    mockMaybeSingle.mockResolvedValue({ data: { id: CONSULT, status: 'scheduled', payment_status: 'pending', scheduled_at: null }, error: null });
    await reconcilePendingPayments();
    expect(await getAttempt(CONSULT)).toBeNull(); // scheduled
    await saveAttempt({ consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF });
    mockMaybeSingle.mockResolvedValue(PAID_ROW);
    await reconcilePendingPayments();
    expect(await getAttempt(CONSULT)).toBeNull(); // paid
  });

  it('reconcile keeps such an attempt (even after 24 h) and reports it as a support case', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    await saveAttempt({ consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF });
    (Date.now as jest.Mock).mockReturnValue(1_800_000_000_000 + 3 * PENDING_ATTEMPT_MAX_AGE_MS);
    mockMaybeSingle.mockResolvedValue(CANCELLED_ROW);
    const cases = await reconcilePendingPayments();
    expect(cases).toEqual([{ consultationId: CONSULT, txnRef: TXN }]);
    expect(mockInvoke).not.toHaveBeenCalled();
    expect((await getAttempt(CONSULT))?.payRef).toBe(PAY_REF);
  });

  it('reconcile reports nothing when every attempt is fine', async () => {
    await saveAttempt({ consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF });
    mockMaybeSingle.mockResolvedValue(PAID_ROW);
    expect(await reconcilePendingPayments()).toEqual([]);
  });
});

describe('fail closed without an authenticated user', () => {
  it('payConsultation throws BEFORE registering or opening the widget when there is no session user', async () => {
    mockCurrentUser = null;
    const openPaymentWidget = jest.fn();
    await expect(payConsultation({ consultationId: CONSULT, openPaymentWidget })).rejects.toBeInstanceOf(
      PaymentRegistrationError,
    );
    expect(openPaymentWidget).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('payExistingConsultation fails closed too (no widget, no register, no confirm)', async () => {
    mockCurrentUser = null;
    mockMaybeSingle.mockResolvedValue(PENDING_ROW);
    const openPaymentWidget = jest.fn();
    await expect(payExistingConsultation({ consultationId: CONSULT, openPaymentWidget })).rejects.toBeInstanceOf(
      PaymentRegistrationError,
    );
    expect(openPaymentWidget).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('a getSession failure also fails closed', async () => {
    mockCurrentUser = '__throw__';
    const openPaymentWidget = jest.fn();
    await expect(payConsultation({ consultationId: CONSULT, openPaymentWidget })).rejects.toBeInstanceOf(
      PaymentRegistrationError,
    );
    expect(openPaymentWidget).not.toHaveBeenCalled();
  });
});

describe('in_progress / completed rows count as confirmed (no false support alert)', () => {
  it.each(['in_progress', 'completed'])('reconcile clears a payRef attempt whose row is %s and reports no support case', async (status) => {
    await saveAttempt({ consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF });
    mockMaybeSingle.mockResolvedValue({ data: { id: CONSULT, status, payment_status: 'pending', scheduled_at: null }, error: null });
    expect(await reconcilePendingPayments()).toEqual([]);
    expect(await getAttempt(CONSULT)).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it.each(['in_progress', 'completed'])('payExisting on a %s row is already_paid, not a support case', async (status) => {
    await saveAttempt({ consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF });
    mockMaybeSingle.mockResolvedValue({ data: { id: CONSULT, status, payment_status: null, scheduled_at: null }, error: null });
    await expect(payExistingConsultation({ consultationId: CONSULT, openPaymentWidget: jest.fn() })).resolves.toEqual({
      status: 'already_paid',
    });
    expect(await getAttempt(CONSULT)).toBeNull();
  });
});

describe('storage resilience', () => {
  // AsyncStorage's jest mock is itself a jest.fn: spying on it replaces its implementation (and `mockRestore` would
  // wipe it), so we capture the real implementation once and reinstall it after each test.
  const setItemMock = AsyncStorage.setItem as unknown as jest.Mock;
  const realSetItem = setItemMock.getMockImplementation() as (k: string, v: string) => Promise<void>;
  afterEach(() => {
    setItemMock.mockImplementation(realSetItem);
  });

  it('a failing post-widget save never stops confirm: confirm is ALWAYS called, payment still confirms', async () => {
    let calls = 0;
    setItemMock.mockImplementation(async (k: string, v: string) => {
      calls += 1;
      if (calls >= 2) throw new Error('disk full'); // 1st save (txnRef only) ok, then everything fails
      return realSetItem(k, v);
    });
    const result = await payConsultation({
      consultationId: CONSULT,
      openPaymentWidget: async () => ({ status: 'success' as const, payRef: PAY_REF }),
    });
    expect(result.status).toBe('confirmed');
    expect(mockInvoke).toHaveBeenCalledWith('confirm-consultation-payment', {
      body: { consultationId: CONSULT, txnRef: result.txnRef, payRef: PAY_REF, useWallet: false },
    });
  });

  it('a failing FIRST save does not block opening the widget either', async () => {
    setItemMock.mockRejectedValue(new Error('disk full'));
    const openPaymentWidget = jest.fn(async (_t: string) => ({ status: 'cancelled' as const }));
    await expect(payConsultation({ consultationId: CONSULT, openPaymentWidget })).resolves.toMatchObject({ status: 'cancelled' });
    expect(openPaymentWidget).toHaveBeenCalledTimes(1);
  });

  it('listing purges attempts older than 24 h', async () => {
    const now = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    await saveAttempt({ consultationId: 'old', txnRef: 'T-old' });
    (Date.now as jest.Mock).mockReturnValue(now + 25 * 3600_000);
    await saveAttempt({ consultationId: 'fresh', txnRef: 'T-fresh' });
    expect((await listAttempts()).map((a) => a.consultationId)).toEqual(['fresh']);
    expect(await getAttempt('old')).toBeNull(); // really removed from storage, not just filtered
  });
});

describe('registerProviderPaymentAttempt (MOB-0712-1)', () => {
  const SUB_ID = '7a1d2c3e-0000-4000-8000-0000000000a1';
  const SUBSCRIPTION = { kind: 'subscription' as const, subscriptionId: SUB_ID, txnRef: TXN };
  const RECHARGE = { kind: 'wallet_recharge' as const, quantity: 10 as const, currency: 'USD', txnRef: TXN };

  it('posts exactly { kind, subscriptionId, txnRef } and NO amount for a subscription', async () => {
    await expect(registerProviderPaymentAttempt(SUBSCRIPTION)).resolves.toEqual({ status: 'registered' });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('register-provider-payment-attempt', {
      body: { kind: 'subscription', subscriptionId: SUB_ID, txnRef: TXN },
    });
    expect(Object.keys(mockInvoke.mock.calls[0][1].body)).toEqual(['kind', 'subscriptionId', 'txnRef']);
    expect(mockInvoke.mock.calls[0][1].body).not.toHaveProperty('amount');
  });

  it('posts exactly { kind, quantity, currency, txnRef } and NO amount for a wallet recharge', async () => {
    await expect(registerProviderPaymentAttempt(RECHARGE)).resolves.toEqual({ status: 'registered' });
    expect(mockInvoke).toHaveBeenCalledWith('register-provider-payment-attempt', {
      body: { kind: 'wallet_recharge', quantity: 10, currency: 'USD', txnRef: TXN },
    });
    expect(Object.keys(mockInvoke.mock.calls[0][1].body)).toEqual(['kind', 'quantity', 'currency', 'txnRef']);
    expect(mockInvoke.mock.calls[0][1].body).not.toHaveProperty('amount');
  });

  it('never leaks an amount (or any stray field) even if a caller smuggles one in', async () => {
    await registerProviderPaymentAttempt({ ...RECHARGE, amount: 1 } as any);
    await registerProviderPaymentAttempt({ ...SUBSCRIPTION, amount: 1, price: 2 } as any);
    expect(mockInvoke.mock.calls[0][1].body).toEqual({ kind: 'wallet_recharge', quantity: 10, currency: 'USD', txnRef: TXN });
    expect(mockInvoke.mock.calls[1][1].body).toEqual({ kind: 'subscription', subscriptionId: SUB_ID, txnRef: TXN });
  });

  it.each([5, 10, 20, 50, 100] as const)('accepts quantity %s', async (quantity) => {
    await expect(registerProviderPaymentAttempt({ ...RECHARGE, quantity })).resolves.toEqual({ status: 'registered' });
  });

  it.each([0, 1, 7, 15, 101, -5, 10.5, NaN, '10', null, undefined])(
    'rejects wallet quantity %p before any call',
    async (quantity) => {
      await expect(registerProviderPaymentAttempt({ ...RECHARGE, quantity: quantity as any })).rejects.toBeInstanceOf(
        PaymentRegistrationError,
      );
      expect(mockInvoke).not.toHaveBeenCalled();
    },
  );

  it('rejects an unknown kind before any call', async () => {
    await expect(registerProviderPaymentAttempt({ kind: 'consultation', txnRef: TXN } as any)).rejects.toBeInstanceOf(
      PaymentRegistrationError,
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('200 { alreadyPaid: true } is a distinct result (no widget needed), not an error', async () => {
    mockInvoke.mockResolvedValue({ data: { alreadyPaid: true }, error: null });
    await expect(registerProviderPaymentAttempt(SUBSCRIPTION)).resolves.toEqual({ status: 'already_paid' });
  });

  it('a network error does not reject: payment may continue (not_registered)', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: networkError });
    await expect(registerProviderPaymentAttempt(SUBSCRIPTION)).resolves.toEqual({ status: 'not_registered' });
    mockInvoke.mockRejectedValue(new TypeError('Network request failed'));
    await expect(registerProviderPaymentAttempt(RECHARGE)).resolves.toEqual({ status: 'not_registered' });
  });

  it.each([429, 503, 500])('HTTP %s does not reject: payment may continue (not_registered)', async (status) => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(status, { error: 'busy' }) });
    await expect(registerProviderPaymentAttempt(SUBSCRIPTION)).resolves.toEqual({ status: 'not_registered' });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('HTTP 404 NOT_FOUND (subscription of another) rejects with a typed error and stops', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(404, { code: 'NOT_FOUND', error: 'Abonnement introuvable' }) });
    const err = await registerProviderPaymentAttempt(SUBSCRIPTION).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentRegistrationError);
    expect(err.status).toBe(404);
    expect(err.message).toBe('Abonnement introuvable');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('HTTP 409 NOT_PAYABLE rejects with PaymentNotPayableError', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(409, { success: false, code: 'NOT_PAYABLE' }) });
    const err = await registerProviderPaymentAttempt(SUBSCRIPTION).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentNotPayableError);
    expect(err.code).toBe('NOT_PAYABLE');
  });

  it.each([
    [400, 'INVALID_REQUEST'],
    [403, 'FORBIDDEN'],
  ])('HTTP %s %s blocks (PaymentRegistrationError)', async (status, code) => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(status, { code, error: 'refus' }) });
    const err = await registerProviderPaymentAttempt(RECHARGE).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentRegistrationError);
    expect(err.status).toBe(status);
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  describe('401', () => {
    it('refreshes the session once then retries once with the same body', async () => {
      mockInvoke
        .mockResolvedValueOnce({ data: null, error: httpError(401, { error: 'JWT expired' }) })
        .mockResolvedValueOnce({ data: { success: true }, error: null });
      await expect(registerProviderPaymentAttempt(SUBSCRIPTION)).resolves.toEqual({ status: 'registered' });
      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(mockInvoke).toHaveBeenCalledTimes(2);
      expect(mockInvoke.mock.calls[1]).toEqual(mockInvoke.mock.calls[0]);
    });

    it('a second 401 blocks (no third call, no second refresh)', async () => {
      mockInvoke.mockResolvedValue({ data: null, error: httpError(401, { error: 'Unauthorized' }) });
      const err = await registerProviderPaymentAttempt(SUBSCRIPTION).catch((e) => e);
      expect(err).toBeInstanceOf(PaymentRegistrationError);
      expect(err.status).toBe(401);
      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });

    it('a failed refresh is a session expiry and blocks without retry', async () => {
      mockInvoke.mockResolvedValue({ data: null, error: httpError(401, {}) });
      mockRefresh.mockResolvedValue({ data: { session: null }, error: { code: 'refresh_token_not_found', message: 'x' } });
      const err = await registerProviderPaymentAttempt(SUBSCRIPTION).catch((e) => e);
      expect(err).toBeInstanceOf(PaymentRegistrationError);
      expect(err.message).toBe('Ta session a expiré, reconnecte-toi.');
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });
  });

  describe('local development simulation', () => {
    const KEYS = ['EXPO_PUBLIC_APP_ENV', 'EXPO_PUBLIC_SIMULATE_PROVIDER_PAYMENT'] as const;
    const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    afterEach(() => {
      // Même objet `process.env` (jamais remplacé) : on restaure clé par clé.
      for (const k of KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });

    it('APP_ENV development + flag "true": register is NOT called and the result is "simulated"', async () => {
      process.env.EXPO_PUBLIC_APP_ENV = 'development';
      process.env.EXPO_PUBLIC_SIMULATE_PROVIDER_PAYMENT = 'true';
      await expect(registerProviderPaymentAttempt(SUBSCRIPTION)).resolves.toEqual({ status: 'simulated' });
      await expect(registerProviderPaymentAttempt(RECHARGE)).resolves.toEqual({ status: 'simulated' });
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it.each(['production', 'uat', 'staging', undefined])(
      'APP_ENV %p + flag "true": register IS called (never active outside development)',
      async (appEnv) => {
        if (appEnv === undefined) delete process.env.EXPO_PUBLIC_APP_ENV;
        else process.env.EXPO_PUBLIC_APP_ENV = appEnv;
        process.env.EXPO_PUBLIC_SIMULATE_PROVIDER_PAYMENT = 'true';
        await expect(registerProviderPaymentAttempt(SUBSCRIPTION)).resolves.toEqual({ status: 'registered' });
        expect(mockInvoke).toHaveBeenCalledTimes(1);
      },
    );

    it.each(['false', '1', '', undefined])('APP_ENV development + flag %p: register IS called', async (flag) => {
      process.env.EXPO_PUBLIC_APP_ENV = 'development';
      if (flag === undefined) delete process.env.EXPO_PUBLIC_SIMULATE_PROVIDER_PAYMENT;
      else process.env.EXPO_PUBLIC_SIMULATE_PROVIDER_PAYMENT = flag;
      await expect(registerProviderPaymentAttempt(SUBSCRIPTION)).resolves.toEqual({ status: 'registered' });
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    it('invalid input is still rejected under simulation', async () => {
      process.env.EXPO_PUBLIC_APP_ENV = 'development';
      process.env.EXPO_PUBLIC_SIMULATE_PROVIDER_PAYMENT = 'true';
      await expect(registerProviderPaymentAttempt({ ...RECHARGE, quantity: 7 as any })).rejects.toBeInstanceOf(
        PaymentRegistrationError,
      );
    });
  });
});

describe('registerProviderPaymentWithRetry', () => {
  const SUB_REQUEST = { kind: 'subscription' as const, subscriptionId: 'sub-1' };
  const bodies = () => mockInvoke.mock.calls.map((c) => c[1].body);

  it('generates a txnRef, registers it and returns it for the widget and the confirmation', async () => {
    const result = await registerProviderPaymentWithRetry(SUB_REQUEST);
    expect(result.status).toBe('registered');
    expect(result.txnRef).toMatch(/^VDC-\d{13}-[A-Z0-9]{7}$/);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(bodies()[0]).toEqual({ kind: 'subscription', subscriptionId: 'sub-1', txnRef: result.txnRef });
  });

  it('409 TXN_ALREADY_USED → exactly one retry with a NEW txnRef, returns the new one', async () => {
    mockInvoke
      .mockResolvedValueOnce({ data: null, error: httpError(409, { success: false, code: 'TXN_ALREADY_USED' }) })
      .mockResolvedValueOnce({ data: { success: true }, error: null });
    const result = await registerProviderPaymentWithRetry({ kind: 'wallet_recharge', quantity: 20, currency: 'CDF' });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    const [first, second] = bodies();
    expect(first.txnRef).not.toBe(second.txnRef);
    expect(second).toEqual({ kind: 'wallet_recharge', quantity: 20, currency: 'CDF', txnRef: second.txnRef });
    expect(result).toEqual({ status: 'registered', txnRef: second.txnRef });
  });

  it('a second TXN_ALREADY_USED rejects (no third call)', async () => {
    // Une `Response` ne se lit qu'une fois : un corps neuf à chaque appel.
    mockInvoke.mockImplementation(async () => ({
      data: null,
      error: httpError(409, { success: false, code: 'TXN_ALREADY_USED' }),
    }));
    const err = await registerProviderPaymentWithRetry(SUB_REQUEST).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentNotPayableError);
    expect(err.code).toBe('TXN_ALREADY_USED');
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it('NOT_PAYABLE is never retried', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(409, { success: false, code: 'NOT_PAYABLE' }) });
    const err = await registerProviderPaymentWithRetry(SUB_REQUEST).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentNotPayableError);
    expect(err.code).toBe('NOT_PAYABLE');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('alreadyPaid is surfaced with the txnRef; non-blocking failures do not reject', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { alreadyPaid: true }, error: null });
    await expect(registerProviderPaymentWithRetry(SUB_REQUEST)).resolves.toMatchObject({ status: 'already_paid' });
    mockInvoke.mockResolvedValueOnce({ data: null, error: httpError(503, {}) });
    await expect(registerProviderPaymentWithRetry(SUB_REQUEST)).resolves.toMatchObject({ status: 'not_registered' });
  });
});
