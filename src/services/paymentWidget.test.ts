import {
  createOpenPaymentWidget,
  getPaymentWidgetConfig,
  getPendingPaymentWidget,
  PaymentWidgetUnavailableError,
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

describe('createOpenPaymentWidget (injected openPaymentWidget bridge)', () => {
  const details = {
    amount: 30000,
    currency: 'CDF',
    customerId: 'u1',
    customerName: 'Fatou K',
    customerEmail: 'f@example.com',
    payItemName: 'Consultation',
  };

  beforeEach(() => {
    mockPush.mockReset();
    settlePaymentWidget({ kind: 'cancelled' });
  });

  it('throws PaymentWidgetUnavailableError, without navigating, when the widget is not configured', async () => {
    const open = createOpenPaymentWidget(details, { config: null });
    await expect(open('VDC-1')).rejects.toBeInstanceOf(PaymentWidgetUnavailableError);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('refuses an unknown currency instead of guessing a numeric code', async () => {
    const open = createOpenPaymentWidget({ ...details, currency: 'ZZZ' }, { config: getPaymentWidgetConfig(env) });
    await expect(open('VDC-1')).rejects.toBeInstanceOf(PaymentWidgetUnavailableError);
  });

  it('opens the payment screen and resolves { status: "success", payRef } when the screen reports success', async () => {
    const open = createOpenPaymentWidget(details, { config: getPaymentWidgetConfig(env) });
    const promise = open('VDC-1730745600000-ABC1234');
    expect(mockPush).toHaveBeenCalledWith('/payment');
    expect(getPendingPaymentWidget()).toMatchObject({
      request: { txnRef: 'VDC-1730745600000-ABC1234', amount: '3000000', currencyNumeric: 976 },
    });
    settlePaymentWidget({ kind: 'success', payRef: 'ISW_PAY_REF_987654' });
    await expect(promise).resolves.toEqual({ status: 'success', payRef: 'ISW_PAY_REF_987654' });
    expect(getPendingPaymentWidget()).toBeNull();
  });

  it('cancelled and declined both resolve { status: "cancelled" }', async () => {
    for (const msg of [{ kind: 'cancelled' as const }, { kind: 'declined' as const, code: 'Z6', desc: '' }]) {
      const promise = createOpenPaymentWidget(details, { config: getPaymentWidgetConfig(env) })('VDC-1');
      settlePaymentWidget(msg);
      await expect(promise).resolves.toEqual({ status: 'cancelled' });
    }
  });

  it('a widget error (script failed to load) rejects with PaymentWidgetUnavailableError', async () => {
    const promise = createOpenPaymentWidget(details, { config: getPaymentWidgetConfig(env) })('VDC-1');
    settlePaymentWidget({ kind: 'error', desc: 'script' });
    await expect(promise).rejects.toBeInstanceOf(PaymentWidgetUnavailableError);
  });
});
