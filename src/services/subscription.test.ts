const mockInvoke = jest.fn();
const mockFrom = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabaseConfigured: true,
  supabase: {
    from: (...args: any[]) => mockFrom(...args),
    functions: { invoke: (...args: any[]) => mockInvoke(...args) },
  },
}));

import {
  createPendingSubscription,
  createSingleSuccessNotifier,
  defaultSubscriptionChannel,
  getSubscriptionState,
  paySubscriptionWithCard,
  startSubscriptionPayment,
} from './subscription';

describe('subscription service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads country prices and active subscription for a provider', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'healthcare_professionals') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { country_id: 'cd-uuid' }, error: null }),
            }),
          }),
        };
      }
      if (table === 'provider_subscriptions') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: { id: 'sub-active', plan: 'monthly', status: 'active', expires_at: '2026-12-31T00:00:00Z' },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'subscription_prices') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  country_id: 'cd-uuid',
                  monthly_price: 25000,
                  annual_price: 250000,
                  currency_code: 'CDF',
                },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const state = await getSubscriptionState('prov-1');
    expect(state.prices).toEqual({
      countryId: 'cd-uuid',
      monthly: 25000,
      annual: 250000,
      currencyCode: 'CDF',
    });
    expect(state.active).toEqual({
      id: 'sub-active',
      plan: 'monthly',
      status: 'active',
      expiresAt: '2026-12-31T00:00:00Z',
    });
  });

  it('creates a pending_payment subscription and returns subscriptionId', async () => {
    const insertMock = jest.fn(() => ({
      select: () => ({
        single: async () => ({ data: { id: 'sub-new-1' }, error: null }),
      }),
    }));
    mockFrom.mockReturnValue({ insert: insertMock });

    const created = await createPendingSubscription({
      providerId: 'prov-1',
      plan: 'monthly',
      amount: 25000,
      currencyCode: 'CDF',
    });

    expect(created).toEqual({ id: 'sub-new-1' });
    expect(insertMock).toHaveBeenCalledWith({
      provider_id: 'prov-1',
      plan: 'monthly',
      amount: 25000,
      currency_code: 'CDF',
      status: 'pending_payment',
      payment_status: 'unpaid',
    });
  });

  it('pays subscription by card via register-provider-payment-attempt, widget and confirm-subscription-payment', async () => {
    mockInvoke
      .mockResolvedValueOnce({ data: { success: true }, error: null })
      .mockResolvedValueOnce({ data: { success: true }, error: null });

    const widget = jest.fn(async () => ({ status: 'success' as const, payRef: 'PAY-123' }));
    const res = await paySubscriptionWithCard('sub-1', widget);

    expect(res).toEqual({ status: 'confirmed' });
    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'register-provider-payment-attempt', {
      body: { kind: 'subscription', subscriptionId: 'sub-1', txnRef: expect.any(String) },
    });
    expect(widget).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'confirm-subscription-payment', {
      body: { subscriptionId: 'sub-1', txnRef: expect.any(String), payRef: 'PAY-123' },
    });
  });

  it('does not open widget when register-provider-payment-attempt returns alreadyPaid', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { alreadyPaid: true }, error: null });
    const widget = jest.fn();

    const res = await paySubscriptionWithCard('sub-already', widget);
    expect(res).toEqual({ status: 'confirmed' });
    expect(widget).not.toHaveBeenCalled();
  });

  it('triggers onSuccess at most once via createSingleSuccessNotifier', async () => {
    const reload = jest.fn();
    const notifyOnce = createSingleSuccessNotifier(reload);

    await notifyOnce();
    await notifyOnce();
    await notifyOnce();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('chooses mobile_money for CDF and card for other currencies', () => {
    expect(defaultSubscriptionChannel('CDF')).toBe('mobile_money');
    expect(defaultSubscriptionChannel('USD')).toBe('card');
  });

  it('starts mobile_money subscription by creating pending_payment subscription without opening widget', async () => {
    const insertMock = jest.fn(() => ({
      select: () => ({
        single: async () => ({ data: { id: 'sub-mm-1' }, error: null }),
      }),
    }));
    mockFrom.mockReturnValue({ insert: insertMock });
    const widget = jest.fn();

    const started = await startSubscriptionPayment({
      providerId: 'prov-1',
      plan: 'monthly',
      amount: 25000,
      currencyCode: 'CDF',
      channel: 'mobile_money',
      openPaymentWidget: widget,
    });

    expect(started).toEqual({ channel: 'mobile_money', subscriptionId: 'sub-mm-1' });
    expect(widget).not.toHaveBeenCalled();
  });

  it('starts card subscription via register-provider-payment-attempt, widget and confirm-subscription-payment', async () => {
    const insertMock = jest.fn(() => ({
      select: () => ({
        single: async () => ({ data: { id: 'sub-card-1' }, error: null }),
      }),
    }));
    mockFrom.mockReturnValue({ insert: insertMock });
    mockInvoke
      .mockResolvedValueOnce({ data: { success: true }, error: null })
      .mockResolvedValueOnce({ data: { success: true }, error: null });
    const widget = jest.fn(async () => ({ status: 'success' as const, payRef: 'PAY-SUB-1' }));

    const started = await startSubscriptionPayment({
      providerId: 'prov-1',
      plan: 'annual',
      amount: 250000,
      currencyCode: 'CDF',
      channel: 'card',
      openPaymentWidget: widget,
    });

    expect(started).toEqual({
      channel: 'card',
      subscriptionId: 'sub-card-1',
      status: 'confirmed',
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'register-provider-payment-attempt', {
      body: { kind: 'subscription', subscriptionId: 'sub-card-1', txnRef: expect.any(String) },
    });
  });
});
