import { supabase, supabaseConfigured } from '@/lib/supabase';
import { translate } from '@/i18n/core';
import {
  PaymentConfirmationError,
  registerProviderPaymentWithRetry,
  type OpenPaymentWidget,
} from './paymentAttempt';

export type SubscriptionPlan = 'monthly' | 'annual';

export interface SubscriptionPrices {
  countryId: string;
  monthly: number;
  annual: number;
  currencyCode: string;
}

export interface ActiveSubscription {
  id: string;
  plan: SubscriptionPlan;
  status: string;
  expiresAt: string | null;
}

export interface SubscriptionState {
  prices: SubscriptionPrices | null;
  active: ActiveSubscription | null;
}

export async function getSubscriptionState(providerId: string): Promise<SubscriptionState> {
  const sb = supabase;
  if (!sb || !supabaseConfigured || !providerId) {
    return { prices: null, active: null };
  }

  const [{ data: hp, error: hpErr }, { data: activeRow, error: activeErr }] = await Promise.all([
    sb
      .from('healthcare_professionals')
      .select('country_id')
      .eq('id', providerId)
      .maybeSingle(),
    sb
      .from('provider_subscriptions')
      .select('id, plan, status, expires_at')
      .eq('provider_id', providerId)
      .eq('status', 'active')
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (hpErr) throw new Error(hpErr.message);
  if (activeErr) throw new Error(activeErr.message);

  let prices: SubscriptionPrices | null = null;
  const countryId = (hp as { country_id?: string } | null)?.country_id;
  if (countryId) {
    const { data: priceRow, error: priceErr } = await sb
      .from('subscription_prices')
      .select('country_id, monthly_price, annual_price, currency_code')
      .eq('country_id', countryId)
      .maybeSingle();
    if (priceErr) throw new Error(priceErr.message);
    if (priceRow) {
      const row = priceRow as {
        country_id: string;
        monthly_price: number;
        annual_price: number;
        currency_code: string;
      };
      prices = {
        countryId: row.country_id,
        monthly: Number(row.monthly_price),
        annual: Number(row.annual_price),
        currencyCode: row.currency_code,
      };
    }
  }

  const activeData = activeRow as {
    id: string;
    plan: SubscriptionPlan;
    status: string;
    expires_at: string | null;
  } | null;

  return {
    prices,
    active: activeData
      ? {
          id: activeData.id,
          plan: activeData.plan,
          status: activeData.status,
          expiresAt: activeData.expires_at ?? null,
        }
      : null,
  };
}

export async function createPendingSubscription(input: {
  providerId: string;
  plan: SubscriptionPlan;
  amount: number;
  currencyCode: string;
}): Promise<{ id: string }> {
  const sb = supabase;
  if (!sb) {
    throw new Error(translate("Impossible de créer l'abonnement."));
  }
  const { data, error } = await sb
    .from('provider_subscriptions')
    .insert({
      provider_id: input.providerId,
      plan: input.plan,
      amount: input.amount,
      currency_code: input.currencyCode,
      status: 'pending_payment',
      payment_status: 'unpaid',
    })
    .select('id')
    .single();

  if (error || !data) {
    // Jamais le texte technique de la base à l'écran : on journalise le code, on affiche un message traduit.
    if (error) console.warn('[subscription] création refusée', error.code ?? 'unknown');
    throw new Error(translate("Impossible de créer l'abonnement."));
  }
  return { id: (data as { id: string }).id };
}

export type CardSubscriptionPayResult =
  | { status: 'confirmed' }
  | { status: 'cancelled' }
  | { status: 'dismissed'; reason?: string };

export async function paySubscriptionWithCard(
  subscriptionId: string,
  openPaymentWidget: OpenPaymentWidget,
): Promise<CardSubscriptionPayResult> {
  const reg = await registerProviderPaymentWithRetry({
    kind: 'subscription',
    subscriptionId,
  });

  if (reg.status === 'already_paid') {
    return { status: 'confirmed' };
  }

  const widget = await openPaymentWidget(reg.txnRef);
  if (widget.status === 'cancelled') return { status: 'cancelled' };
  if (widget.status === 'dismissed') return { status: 'dismissed', reason: widget.reason };

  const sb = supabase;
  if (!sb) {
    throw new PaymentConfirmationError(
      translate("Le paiement est en cours de vérification. Vérifie ton abonnement dans quelques instants."),
    );
  }

  const payRef = 'payRef' in widget && typeof widget.payRef === 'string' ? widget.payRef : '';
  const { data, error } = await sb.functions.invoke('confirm-subscription-payment', {
    body: {
      subscriptionId,
      txnRef: reg.txnRef,
      payRef,
    },
  });

  if (error || !(data as { success?: boolean } | null)?.success) {
    throw new PaymentConfirmationError(
      translate("Le paiement est en cours de vérification. Vérifie ton abonnement dans quelques instants."),
    );
  }

  return { status: 'confirmed' };
}

export function createSingleSuccessNotifier(onSuccess: () => Promise<void> | void): () => Promise<void> {
  let called = false;
  return async () => {
    if (called) return;
    called = true;
    await onSuccess();
  };
}

export type SubscriptionPaymentChannel = 'mobile_money' | 'card';

export function defaultSubscriptionChannel(currencyCode: string): SubscriptionPaymentChannel {
  return currencyCode === 'CDF' ? 'mobile_money' : 'card';
}

export async function startSubscriptionPayment(params: {
  providerId: string;
  plan: SubscriptionPlan;
  amount: number;
  currencyCode: string;
  channel: SubscriptionPaymentChannel;
  openPaymentWidget: OpenPaymentWidget;
}): Promise<
  | { channel: 'mobile_money'; subscriptionId: string }
  | ({ channel: 'card'; subscriptionId: string } & CardSubscriptionPayResult)
> {
  const { id: subscriptionId } = await createPendingSubscription({
    providerId: params.providerId,
    plan: params.plan,
    amount: params.amount,
    currencyCode: params.currencyCode,
  });

  if (params.channel === 'mobile_money') {
    return { channel: 'mobile_money', subscriptionId };
  }

  const cardResult = await paySubscriptionWithCard(subscriptionId, params.openPaymentWidget);
  return { channel: 'card', subscriptionId, ...cardResult };
}

