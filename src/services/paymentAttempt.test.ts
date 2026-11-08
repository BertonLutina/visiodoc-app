import {
  confirmConsultationPayment,
  generateTxnRef,
  payConsultation,
  PaymentConfirmationError,
  PaymentNotPayableError,
  registerConsultationPayment,
} from './paymentAttempt';

// Seule frontière simulée : `@/lib/supabase` (Edge Functions + garde-fou : aucune écriture directe).
const mockInvoke = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabaseConfigured: true,
  supabase: {
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
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

beforeEach(() => {
  mockInvoke.mockReset();
  mockFrom.mockReset();
  mockInvoke.mockResolvedValue({ data: { success: true }, error: null });
});

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

  it.each([400, 401, 403, 404])('a definitive HTTP %s rejection blocks the payment', async (status) => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(status, { error: 'nope' }) });
    await expect(registerConsultationPayment(CONSULT, TXN)).rejects.toBeInstanceOf(Error);
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
      expect(callNames()).toEqual(['register-payment-attempt']);
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
    expect(mockFrom).not.toHaveBeenCalled();
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
