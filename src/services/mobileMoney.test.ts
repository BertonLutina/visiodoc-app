import {
  computeWalletRechargeTotal,
  detectLocalOperator,
  getMyWalletRechargePrice,
  initiateMobileMoneyPayment,
  normalizeCongoleseMobileMoneyPhone,
  resolveMobileMoneyPrefillPhone,
  startMobileMoneyStatusPolling,
} from './mobileMoney';

const mockInvoke = jest.fn();
const mockRpc = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabaseConfigured: true,
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

describe('mobileMoney service (M-1811-1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe('phone validation and prefill rules (MOB-1711-2)', () => {
    it('accepts valid Congolese mobile numbers in international and national forms', () => {
      expect(normalizeCongoleseMobileMoneyPhone('+243854298797')).toEqual({
        msisdn: '243854298797',
        national: '0854298797',
        local9: '854298797',
      });
      expect(normalizeCongoleseMobileMoneyPhone('0854298797')?.msisdn).toBe('243854298797');
      expect(normalizeCongoleseMobileMoneyPhone('854298797')?.msisdn).toBe('243854298797');
      expect(normalizeCongoleseMobileMoneyPhone('00243812345678')?.msisdn).toBe('243812345678');
      expect(normalizeCongoleseMobileMoneyPhone('0912345678')?.msisdn).toBe('243912345678');
    });

    it('rejects foreign or non-mobile numbers (never sends them)', () => {
      expect(normalizeCongoleseMobileMoneyPhone('+32470123456')).toBeNull();
      expect(normalizeCongoleseMobileMoneyPhone('0470123456')).toBeNull();
      expect(normalizeCongoleseMobileMoneyPhone('612345678')).toBeNull();
      expect(normalizeCongoleseMobileMoneyPhone('912345678')).toBeNull();
      expect(normalizeCongoleseMobileMoneyPhone('+14155551234')).toBeNull();
      expect(normalizeCongoleseMobileMoneyPhone('')).toBeNull();
    });

    it('prefills Congolese phone and leaves field empty for foreign or missing phone', () => {
      expect(resolveMobileMoneyPrefillPhone('+243812345678')).toBe('0812345678');
      expect(resolveMobileMoneyPrefillPhone('0854298797')).toBe('0854298797');
      expect(resolveMobileMoneyPrefillPhone('+32470123456')).toBe('');
      expect(resolveMobileMoneyPrefillPhone('0470123456')).toBe('');
      expect(resolveMobileMoneyPrefillPhone('')).toBe('');
      expect(resolveMobileMoneyPrefillPhone(null)).toBe('');
    });

    it('detects Congolese Mobile Money operators from prefixes', () => {
      expect(detectLocalOperator('0854298797')).toBe('ORANGE');
      expect(detectLocalOperator('0812345678')).toBe('MPESA');
      expect(detectLocalOperator('0971234567')).toBe('AIRTELMONEY');
      expect(detectLocalOperator('0901234567')).toBe('AFRIMONEY');
    });
  });

  describe('initiateMobileMoneyPayment (MOB-0812-1 & MOB-1711-2)', () => {
    it('blocks invalid phone locally before calling mobile-money-initiate', async () => {
      const res = await initiateMobileMoneyPayment({
        target: { kind: 'consultation', consultationId: 'c-1' },
        phone: '+32470123456',
      });
      expect(res.success).toBe(false);
      expect(res.code).toBe('INVALID_PHONE');
      expect(res.error).toBe('Numéro de téléphone invalide');
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('maps server INVALID_PHONE, OPERATOR_REQUIRED, NOT_PAYABLE and 503 PROVIDER_UNREACHABLE', async () => {
      mockInvoke.mockResolvedValueOnce({
        data: null,
        error: { context: { status: 400, json: async () => ({ code: 'INVALID_PHONE' }) } },
      });
      const invalidRes = await initiateMobileMoneyPayment({
        target: { kind: 'consultation', consultationId: 'c-1' },
        phone: '0854298797',
      });
      expect(invalidRes.error).toBe('Numéro de téléphone invalide');

      mockInvoke.mockResolvedValueOnce({
        data: null,
        error: { context: { status: 422, json: async () => ({ code: 'OPERATOR_REQUIRED' }) } },
      });
      const opRes = await initiateMobileMoneyPayment({
        target: { kind: 'subscription', subscriptionId: 'sub-1' },
        phone: '0854298797',
      });
      expect(opRes.operatorRequired).toBe(true);

      mockInvoke.mockResolvedValueOnce({
        data: null,
        error: { context: { status: 503, json: async () => ({ code: 'PROVIDER_UNREACHABLE' }) } },
      });
      const unreachRes = await initiateMobileMoneyPayment({
        target: { kind: 'wallet_recharge', quantity: 10, currency: 'CDF' },
        phone: '0854298797',
      });
      expect(unreachRes.providerUnreachable).toBe(true);
    });

    it('sends expected payload without amount or txnRef for all 3 flows', async () => {
      mockInvoke.mockResolvedValue({
        data: { success: true, txnRef: 'MM-1', operator: 'ORANGE', pending: true },
        error: null,
      });

      await initiateMobileMoneyPayment({
        target: { kind: 'consultation', consultationId: 'c-1', useWallet: true },
        phone: '0854298797',
      });
      expect(mockInvoke).toHaveBeenLastCalledWith('mobile-money-initiate', {
        body: { kind: 'consultation', consultationId: 'c-1', useWallet: true, phone: '243854298797' },
      });

      await initiateMobileMoneyPayment({
        target: { kind: 'subscription', subscriptionId: 'sub-1' },
        phone: '+243812345678',
        operator: 'MPESA',
      });
      expect(mockInvoke).toHaveBeenLastCalledWith('mobile-money-initiate', {
        body: { kind: 'subscription', subscriptionId: 'sub-1', phone: '243812345678', operator: 'MPESA' },
      });

      await initiateMobileMoneyPayment({
        target: { kind: 'wallet_recharge', quantity: 10, currency: 'CDF' },
        phone: '854298797',
      });
      expect(mockInvoke).toHaveBeenLastCalledWith('mobile-money-initiate', {
        body: { kind: 'wallet_recharge', quantity: 10, currency: 'CDF', phone: '243854298797' },
      });
    });
  });

  describe('startMobileMoneyStatusPolling', () => {
    it('calls onPaid exactly once even if multiple paid responses arrive, then stops', async () => {
      jest.useFakeTimers();
      mockInvoke.mockResolvedValue({ data: { success: true, state: 'paid' }, error: null });
      const onPaid = jest.fn();

      startMobileMoneyStatusPolling({
        txnRef: 'MM-PAID',
        onPaid,
        initialDelayMs: 100,
        intervalMs: 100,
      });

      await jest.advanceTimersByTimeAsync(500);
      expect(onPaid).toHaveBeenCalledTimes(1);
      expect(onPaid).toHaveBeenCalledWith('MM-PAID');
    });

    it('calls onTerminal on failed/expired/review and stops on unmount', async () => {
      jest.useFakeTimers();
      mockInvoke.mockResolvedValue({
        data: { success: true, state: 'failed', providerCode: 'Z68' },
        error: null,
      });
      const onTerminal = jest.fn();

      startMobileMoneyStatusPolling({
        txnRef: 'MM-FAIL',
        onPaid: jest.fn(),
        onTerminal,
        initialDelayMs: 100,
        intervalMs: 100,
      });

      await jest.advanceTimersByTimeAsync(300);
      expect(onTerminal).toHaveBeenCalledTimes(1);
      expect(onTerminal).toHaveBeenCalledWith('failed', expect.objectContaining({ state: 'failed' }));

      mockInvoke.mockClear();
      const onPaid = jest.fn();
      const poller = startMobileMoneyStatusPolling({
        txnRef: 'MM-UNMOUNT',
        onPaid,
        initialDelayMs: 100,
        intervalMs: 100,
      });
      poller.stop();
      await jest.advanceTimersByTimeAsync(500);
      expect(mockInvoke).not.toHaveBeenCalled();
      expect(onPaid).not.toHaveBeenCalled();
    });
  });

  describe('getMyWalletRechargePrice & computeWalletRechargeTotal (MOB-0911-1)', () => {
    it('reads country recharge price from get_my_wallet_recharge_price RPC', async () => {
      mockRpc.mockResolvedValueOnce({
        data: [{ unit_price: '2500.00', price_currency: 'CDF', source: 'country' }],
        error: null,
      });

      const price = await getMyWalletRechargePrice();
      expect(mockRpc).toHaveBeenCalledWith('get_my_wallet_recharge_price');
      expect(price).toEqual({ unitPrice: 2500, priceCurrency: 'CDF', source: 'country' });
      expect(computeWalletRechargeTotal(2500, 10, 'CDF', 'CDF')).toEqual({
        amount: 25000,
        currency: 'CDF',
      });
    });

    it('returns error when cross-currency rate is missing', () => {
      expect(computeWalletRechargeTotal(2500, 5, 'CDF', 'USD')).toEqual({
        error: 'Taux de change non configuré pour cette devise.',
      });
    });
  });
});
