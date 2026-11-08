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
} from './paymentAttempt';
import { getPendingAttempt, listPendingAttempts, savePendingAttempt } from './pendingPaymentAttempt';
import { onSessionExpired } from './sessionExpiry';
import { clearPendingAttempt as clearAttempt } from './pendingPaymentAttempt';

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
    auth: { refreshSession: (...a: unknown[]) => mockRefresh(...a) },
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
    expect(await getPendingAttempt(CONSULT)).toBeNull();
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
      seen = await getPendingAttempt(CONSULT);
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
      if (name === 'confirm-consultation-payment') atConfirm = await getPendingAttempt(CONSULT);
      return { data: { success: true }, error: null };
    });
    await payConsultation({ consultationId: CONSULT, openPaymentWidget: success });
    expect(atConfirm).toMatchObject({ consultationId: CONSULT, payRef: PAY_REF });
  });

  it('clears it only after confirm succeeded AND the re-read row is paid', async () => {
    await payConsultation({ consultationId: CONSULT, openPaymentWidget: success });
    expect(mockFrom).toHaveBeenCalledWith('consultations');
    expect(await getPendingAttempt(CONSULT)).toBeNull();
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
    expect(await getPendingAttempt(CONSULT)).toMatchObject({ payRef: PAY_REF });
  });

  it('keeps it (and surfaces PaymentConfirmationError) when confirm answered but the row is not paid', async () => {
    mockMaybeSingle.mockResolvedValue(PENDING_ROW);
    await expect(payConsultation({ consultationId: CONSULT, openPaymentWidget: success })).rejects.toBeInstanceOf(
      PaymentConfirmationError,
    );
    expect(await getPendingAttempt(CONSULT)).toMatchObject({ payRef: PAY_REF });
  });

  it('keeps it when the re-read itself fails', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await expect(payConsultation({ consultationId: CONSULT, openPaymentWidget: success })).rejects.toBeInstanceOf(
      PaymentConfirmationError,
    );
    expect(await getPendingAttempt(CONSULT)).not.toBeNull();
  });

  it('a paid_unconfirmed widget result (charged, no payRef) keeps the txnRef and says do not pay again', async () => {
    const err = await payConsultation({
      consultationId: CONSULT,
      openPaymentWidget: async () => ({ status: 'paid_unconfirmed' as const }),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentConfirmationError);
    expect(err.message).toBe('Paiement effectué, ne repaie pas. Nous vérifions ta transaction.');
    expect(mockInvoke.mock.calls.map((c) => c[0])).toEqual(['register-payment-attempt']);
    const stored = await getPendingAttempt(CONSULT);
    expect(stored).toMatchObject({ consultationId: CONSULT });
    expect(stored?.payRef).toBeUndefined();
  });

  it('a widget that cannot launch clears the attempt (nothing was charged)', async () => {
    await expect(
      payConsultation({ consultationId: CONSULT, openPaymentWidget: jest.fn().mockRejectedValue(new Error('down')) }),
    ).rejects.toThrow('down');
    expect(await getPendingAttempt(CONSULT)).toBeNull();
  });
});

describe('payExistingConsultation (re-read first, retry confirm before any new widget)', () => {
  const widget = () => jest.fn(async (_txnRef: string) => ({ status: 'cancelled' as const }));
  const names = () => mockInvoke.mock.calls.map((c) => c[0]);

  it('refuses to pay a consultation that is already paid/scheduled (and drops a stale attempt)', async () => {
    await savePendingAttempt({ consultationId: CONSULT, txnRef: TXN });
    const openPaymentWidget = widget();
    await expect(payExistingConsultation({ consultationId: CONSULT, openPaymentWidget })).resolves.toEqual({
      status: 'already_paid',
    });
    expect(openPaymentWidget).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(await getPendingAttempt(CONSULT)).toBeNull();
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
    await savePendingAttempt({ consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF });
    mockMaybeSingle.mockResolvedValueOnce(PENDING_ROW).mockResolvedValueOnce(PAID_ROW);
    const openPaymentWidget = widget();
    const result = await payExistingConsultation({ consultationId: CONSULT, openPaymentWidget });
    expect(result).toEqual({ status: 'confirmed', txnRef: TXN });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('confirm-consultation-payment', {
      body: { consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF, useWallet: false },
    });
    expect(openPaymentWidget).not.toHaveBeenCalled();
    expect(await getPendingAttempt(CONSULT)).toBeNull();
  });

  it('stored attempt WITH payRef whose confirm still fails: error, no new widget, attempt kept', async () => {
    await savePendingAttempt({ consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF });
    mockMaybeSingle.mockResolvedValue(PENDING_ROW);
    mockInvoke.mockResolvedValue({ data: null, error: networkError });
    const openPaymentWidget = widget();
    await expect(payExistingConsultation({ consultationId: CONSULT, openPaymentWidget })).rejects.toBeInstanceOf(
      PaymentConfirmationError,
    );
    expect(openPaymentWidget).not.toHaveBeenCalled();
    expect(await getPendingAttempt(CONSULT)).toMatchObject({ payRef: PAY_REF });
  });

  it('confirm answering NOT_PAYABLE ("handled") with the row STILL unpaid: no new widget, support-case error, attempt kept', async () => {
    await savePendingAttempt({ consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF });
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
    expect(await getPendingAttempt(CONSULT)).toMatchObject({ payRef: PAY_REF });
  });

  it('confirm answering NOT_PAYABLE but the re-read row is paid: confirmed and the attempt is cleared', async () => {
    await savePendingAttempt({ consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF });
    mockMaybeSingle.mockResolvedValueOnce(PENDING_ROW).mockResolvedValue(PAID_ROW);
    mockInvoke.mockResolvedValue({ data: null, error: httpError(409, { success: false, code: 'NOT_PAYABLE' }) });
    const openPaymentWidget = widget();
    await expect(payExistingConsultation({ consultationId: CONSULT, openPaymentWidget })).resolves.toEqual({
      status: 'confirmed',
      txnRef: TXN,
    });
    expect(openPaymentWidget).not.toHaveBeenCalled();
    expect(await getPendingAttempt(CONSULT)).toBeNull();
  });

  it('stored attempt WITHOUT payRef (< 15 min): do not open a widget, say it is being verified', async () => {
    await savePendingAttempt({ consultationId: CONSULT, txnRef: TXN });
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
    await savePendingAttempt({ consultationId: CONSULT, txnRef: TXN });
    mockMaybeSingle.mockResolvedValue(PENDING_ROW);
    const openPaymentWidget = widget();
    const r = await payExistingConsultation({ consultationId: CONSULT, openPaymentWidget, override: true });
    expect(r).toEqual({ status: 'verifying', canOverride: false });
    expect(openPaymentWidget).not.toHaveBeenCalled();
  });

  it('after 15 minutes the user may override explicitly; without override it still only reports verifying', async () => {
    const t0 = 1_800_000_000_000;
    const now = jest.spyOn(Date, 'now').mockReturnValue(t0);
    await savePendingAttempt({ consultationId: CONSULT, txnRef: TXN });
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
    await savePendingAttempt({ consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF });
    mockMaybeSingle.mockResolvedValueOnce(PENDING_ROW).mockResolvedValueOnce(PAID_ROW);
    await reconcilePendingPayments();
    expect(mockInvoke).toHaveBeenCalledWith('confirm-consultation-payment', {
      body: { consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF, useWallet: false },
    });
    expect(await getPendingAttempt(CONSULT)).toBeNull();
  });

  it('drops attempts whose row is already paid without confirming again', async () => {
    await savePendingAttempt({ consultationId: CONSULT, txnRef: TXN });
    await reconcilePendingPayments();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(await getPendingAttempt(CONSULT)).toBeNull();
  });

  it('leaves an uncertain attempt (no payRef) on a pending row untouched and never confirms it', async () => {
    await savePendingAttempt({ consultationId: CONSULT, txnRef: TXN });
    mockMaybeSingle.mockResolvedValue(PENDING_ROW);
    await reconcilePendingPayments();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(await getPendingAttempt(CONSULT)).toMatchObject({ txnRef: TXN });
  });

  it('never throws (a failing confirm keeps the attempt for the next focus)', async () => {
    await savePendingAttempt({ consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF });
    mockMaybeSingle.mockResolvedValue(PENDING_ROW);
    mockInvoke.mockResolvedValue({ data: null, error: networkError });
    await expect(reconcilePendingPayments()).resolves.toBeUndefined();
    expect(await getPendingAttempt(CONSULT)).toMatchObject({ payRef: PAY_REF });
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
      const stored = await getPendingAttempt(CONSULT);
      expect(stored).toMatchObject({ consultationId: CONSULT, txnRef: (result as any).txnRef });
      expect(stored?.payRef).toBeUndefined();
    },
  );

  it('a gateway cancel (explicit) still clears the attempt', async () => {
    await payConsultation({ consultationId: CONSULT, openPaymentWidget: async () => ({ status: 'cancelled' as const }) });
    expect(await getPendingAttempt(CONSULT)).toBeNull();
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
      await savePendingAttempt({ consultationId: CONSULT, txnRef: TXN });
      await resolveDismissedAttempt(CONSULT, false);
      expect(await getPendingAttempt(CONSULT)).toBeNull();
    });
    it('Oui → the attempt is kept (verifying message, 15-minute override later)', async () => {
      await savePendingAttempt({ consultationId: CONSULT, txnRef: TXN });
      await resolveDismissedAttempt(CONSULT, true);
      expect(await getPendingAttempt(CONSULT)).toMatchObject({ txnRef: TXN });
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

    await savePendingAttempt({ consultationId: CONSULT, txnRef: TXN, payRef: PAY_REF }); // would be re-confirmed if unguarded
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
    await savePendingAttempt({ consultationId: 'old', txnRef: 'T-old' });
    (Date.now as jest.Mock).mockReturnValue(now + 25 * 3600_000);
    await savePendingAttempt({ consultationId: 'fresh', txnRef: 'T-fresh' });
    expect((await listPendingAttempts()).map((a) => a.consultationId)).toEqual(['fresh']);
    expect(await getPendingAttempt('old')).toBeNull(); // really removed from storage, not just filtered
  });
});
