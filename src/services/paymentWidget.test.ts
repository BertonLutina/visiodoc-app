import {
  createOpenPaymentWidget,
  getPaymentWidgetConfig,
  getPendingPaymentWidget,
  PaymentWidgetUnavailableError,
  paymentWidgetPreflight,
  settlePaymentWidget,
  toSmallestUnit,
  currencyNumericCode,
} from './paymentWidget';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('expo-linking', () => ({ createURL: (p: string) => `visiodoc://${p.replace(/^\//, '')}` }));

const env = {
  EXPO_PUBLIC_ISW_MODE: 'TEST',
  EXPO_PUBLIC_ISW_MERCHANT_CODE: 'MX123',
  EXPO_PUBLIC_ISW_PAY_ITEM_ID: 'PI456',
};

describe('getPaymentWidgetConfig', () => {
  it('reads the same settings the web falls back on (mode, merchant code, pay item id)', () => {
    expect(getPaymentWidgetConfig(env)).toEqual({
      merchantCode: 'MX123',
      payItemId: 'PI456',
      mode: 'TEST',
      redirectUrl: 'visiodoc://(patient)/appointments',
      scriptUrl: 'https://webpay-ui.k8.isw.la/inline-checkout.js',
    });
  });

  it('uses the live script for LIVE and an explicit script/redirect override', () => {
    expect(getPaymentWidgetConfig({ ...env, EXPO_PUBLIC_ISW_MODE: 'LIVE' })?.scriptUrl).toBe(
      'https://webpay.interswitchng.com/inline-checkout.js',
    );
    const c = getPaymentWidgetConfig({
      ...env,
      EXPO_PUBLIC_ISW_SCRIPT_URL: 'https://x.example/s.js',
      EXPO_PUBLIC_ISW_REDIRECT_URL: 'https://x.example/back',
    });
    expect(c).toMatchObject({ scriptUrl: 'https://x.example/s.js', redirectUrl: 'https://x.example/back' });
  });

  it('is null (widget unavailable) when merchant / pay item are missing or the mode is LOCAL/unknown', () => {
    expect(getPaymentWidgetConfig({})).toBeNull();
    expect(getPaymentWidgetConfig({ ...env, EXPO_PUBLIC_ISW_MERCHANT_CODE: '' })).toBeNull();
    expect(getPaymentWidgetConfig({ ...env, EXPO_PUBLIC_ISW_MODE: 'LOCAL' })).toBeNull();
    expect(getPaymentWidgetConfig({ ...env, EXPO_PUBLIC_ISW_MODE: undefined })).toBeNull();
  });
});

describe('amount helpers (web interswitchService / InterswitchCheckoutButton)', () => {
  it('converts to the smallest unit and maps ISO to numeric codes', () => {
    expect(toSmallestUnit(30000, 'CDF')).toBe('3000000');
    expect(toSmallestUnit(15.5, 'USD')).toBe('1550');
    expect(toSmallestUnit(5000, 'XAF')).toBe('5000');
    expect(currencyNumericCode('CDF')).toBe(976);
    expect(currencyNumericCode('usd')).toBe(840);
    expect(currencyNumericCode('ZZZ')).toBeNull();
  });
});

describe('paymentWidgetPreflight (checked BEFORE any consultation is inserted)', () => {
  it('is ok with a configured widget and a supported currency', () => {
    expect(paymentWidgetPreflight('CDF', getPaymentWidgetConfig(env))).toEqual({ ok: true });
  });
  it('reports not_configured and unsupported_currency distinctly', () => {
    expect(paymentWidgetPreflight('CDF', null)).toEqual({ ok: false, reason: 'not_configured' });
    expect(paymentWidgetPreflight('ZZZ', getPaymentWidgetConfig(env))).toEqual({ ok: false, reason: 'unsupported_currency' });
    expect(paymentWidgetPreflight(null, getPaymentWidgetConfig(env))).toEqual({ ok: false, reason: 'unsupported_currency' });
  });
});

describe('createOpenPaymentWidget (injected openPaymentWidget bridge)', () => {
  const details = {
    amount: 30000,
    currency: 'CDF',
    customerId: 'u1',
    customerName: 'Fatou K',
    customerEmail: 'f@example.com',
    payItemName: 'Consultation',
  };
  const open = (txnRef: string, d = details) => createOpenPaymentWidget(d, { config: getPaymentWidgetConfig(env) })(txnRef);

  beforeEach(() => {
    mockPush.mockReset();
    settlePaymentWidget('VDC-1', { kind: 'cancelled' });
    settlePaymentWidget('VDC-A', { kind: 'cancelled' });
    settlePaymentWidget('VDC-B', { kind: 'cancelled' });
  });

  it('throws PaymentWidgetUnavailableError, without navigating, when the widget is not configured', async () => {
    await expect(createOpenPaymentWidget(details, { config: null })('VDC-1')).rejects.toBeInstanceOf(
      PaymentWidgetUnavailableError,
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('refuses an unknown currency instead of guessing a numeric code', async () => {
    await expect(open('VDC-1', { ...details, currency: 'ZZZ' })).rejects.toBeInstanceOf(PaymentWidgetUnavailableError);
  });

  it('opens the payment screen for that txnRef and resolves success + payRef when settled with the same txnRef', async () => {
    const promise = open('VDC-1730745600000-ABC1234');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/payment', params: { txnRef: 'VDC-1730745600000-ABC1234' } });
    expect(getPendingPaymentWidget('VDC-1730745600000-ABC1234')).toMatchObject({
      request: { txnRef: 'VDC-1730745600000-ABC1234', amount: '3000000', currencyNumeric: 976 },
    });
    settlePaymentWidget('VDC-1730745600000-ABC1234', { kind: 'success', payRef: 'ISW_PAY_REF_987654' });
    await expect(promise).resolves.toEqual({ status: 'success', payRef: 'ISW_PAY_REF_987654' });
    expect(getPendingPaymentWidget('VDC-1730745600000-ABC1234')).toBeNull();
  });

  it('a result for request A can never resolve request B (settle is keyed by txnRef)', async () => {
    const a = open('VDC-A');
    const b = open('VDC-B');
    // B supersedes A on screen: A is released as cancelled, B stays pending.
    await expect(a).resolves.toEqual({ status: 'cancelled' });
    expect(getPendingPaymentWidget('VDC-A')).toBeNull();
    settlePaymentWidget('VDC-A', { kind: 'success', payRef: 'PAYREF-A' });
    expect(getPendingPaymentWidget('VDC-B')).not.toBeNull();
    settlePaymentWidget('VDC-B', { kind: 'success', payRef: 'PAYREF-B' });
    await expect(b).resolves.toEqual({ status: 'success', payRef: 'PAYREF-B' });
  });

  it('an unknown txnRef settles nothing', async () => {
    const p = open('VDC-A');
    let done = false;
    p.then(() => (done = true));
    settlePaymentWidget('VDC-OTHER', { kind: 'success', payRef: 'X' });
    await Promise.resolve();
    expect(done).toBe(false);
    settlePaymentWidget('VDC-A', { kind: 'cancelled' });
    await p;
  });

  it('cancelled and declined both resolve { status: "cancelled" }', async () => {
    for (const msg of [{ kind: 'cancelled' as const }, { kind: 'declined' as const, code: 'Z6', desc: '' }]) {
      const promise = open('VDC-1');
      settlePaymentWidget('VDC-1', msg);
      await expect(promise).resolves.toEqual({ status: 'cancelled' });
    }
  });

  it('paid_unconfirmed resolves { status: "paid_unconfirmed" }', async () => {
    const promise = open('VDC-1');
    settlePaymentWidget('VDC-1', { kind: 'paid_unconfirmed' });
    await expect(promise).resolves.toEqual({ status: 'paid_unconfirmed' });
  });

  it('a widget error (script failed to load) rejects with PaymentWidgetUnavailableError', async () => {
    const promise = open('VDC-1');
    settlePaymentWidget('VDC-1', { kind: 'error', desc: 'script' });
    await expect(promise).rejects.toBeInstanceOf(PaymentWidgetUnavailableError);
  });
});
