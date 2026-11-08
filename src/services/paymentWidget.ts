import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { translate } from '@/i18n/core';
import type { OpenPaymentWidget } from './paymentAttempt';
import type { InlineCheckoutConfig, InlineCheckoutRequest, WidgetMessage } from '@/utils/paymentForm';

/* ------------------------------------------------------------------------------------------------
 * Pont entre la logique de réservation (qui attend une promesse `openPaymentWidget(txnRef)`) et l'écran
 * `app/payment.tsx` (WebView qui exécute le widget MultiPay / Interswitch inline checkout).
 * Le guide ne décrit pas le widget : tout ce qui suit est tiré du web (InterswitchCheckoutButton.tsx,
 * interswitchService.ts). La configuration passerelle (`payment_gateways`) n'est lisible que par un
 * admin côté web : sur mobile elle vient des variables EXPO_PUBLIC_ISW_* (voir getPaymentWidgetConfig).
 * ---------------------------------------------------------------------------------------------- */

const RETURN_PATH = '/(patient)/appointments';

/** Le widget ne peut pas démarrer (configuration absente, devise inconnue, script non chargé). */
export class PaymentWidgetUnavailableError extends Error {
  consultationId?: string;
  constructor(detail?: string) {
    super(
      translate("Le paiement n'est pas disponible pour le moment. Ta consultation reste en attente de paiement.") +
        (detail ? ` (${detail})` : ''),
    );
    this.name = 'PaymentWidgetUnavailableError';
  }
}

/** Valeurs de repli du web (`ISW_SCRIPT_SRC_FALLBACK`). */
const SCRIPT_FALLBACK: Record<'TEST' | 'LIVE', string> = {
  TEST: 'https://webpay-ui.k8.isw.la/inline-checkout.js',
  LIVE: 'https://webpay.interswitchng.com/inline-checkout.js',
};

type Env = Record<string, string | undefined>;

/** Expo n'injecte que les références statiques `process.env.EXPO_PUBLIC_*`. */
const appEnv = (): Env => ({
  EXPO_PUBLIC_ISW_MODE: process.env.EXPO_PUBLIC_ISW_MODE,
  EXPO_PUBLIC_ISW_MERCHANT_CODE: process.env.EXPO_PUBLIC_ISW_MERCHANT_CODE,
  EXPO_PUBLIC_ISW_PAY_ITEM_ID: process.env.EXPO_PUBLIC_ISW_PAY_ITEM_ID,
  EXPO_PUBLIC_ISW_SCRIPT_URL: process.env.EXPO_PUBLIC_ISW_SCRIPT_URL,
  EXPO_PUBLIC_ISW_REDIRECT_URL: process.env.EXPO_PUBLIC_ISW_REDIRECT_URL,
});

/**
 * Configuration du widget, miroir du repli web (`VITE_ISW_MODE` / `_MERCHANT_CODE` / `_PAY_ITEM_ID` /
 * `_REDIRECT_URL`). `null` = widget non configuré (mode absent, `LOCAL` simulé, code marchand ou
 * article de paiement manquant). Aucune clé en dur ; `merchant_code` / `pay_item_id` ne sont pas secrets.
 */
export function getPaymentWidgetConfig(env: Env = appEnv()): InlineCheckoutConfig | null {
  const mode = env.EXPO_PUBLIC_ISW_MODE;
  if (mode !== 'TEST' && mode !== 'LIVE') return null;
  const merchantCode = env.EXPO_PUBLIC_ISW_MERCHANT_CODE?.trim();
  const payItemId = env.EXPO_PUBLIC_ISW_PAY_ITEM_ID?.trim();
  if (!merchantCode || !payItemId) return null;
  return {
    merchantCode,
    payItemId,
    mode,
    redirectUrl: env.EXPO_PUBLIC_ISW_REDIRECT_URL?.trim() || Linking.createURL(RETURN_PATH),
    scriptUrl: env.EXPO_PUBLIC_ISW_SCRIPT_URL?.trim() || SCRIPT_FALLBACK[mode],
  };
}

/** Plus petite unité (web `toSmallestUnit`) : XAF sans décimale, les autres ×100. */
export function toSmallestUnit(amount: number, currency: string): string {
  const multipliers: Record<string, number> = { NGN: 100, USD: 100, CDF: 100, XAF: 1, EUR: 100, GHS: 100, KES: 100 };
  return String(Math.round(amount * (multipliers[currency.toUpperCase()] ?? 100)));
}

/** Codes ISO 4217 numériques du web (`CURRENCY_CODES`), `null` si la devise est inconnue (pas de repli USD). */
const CURRENCY_NUMERIC: Record<string, number> = {
  NGN: 566,
  USD: 840,
  EUR: 978,
  GBP: 826,
  CDF: 976,
  XAF: 950,
  GHS: 936,
  KES: 404,
};
export const currencyNumericCode = (currency: string): number | null => CURRENCY_NUMERIC[currency.toUpperCase()] ?? null;

export interface PaymentWidgetDetails {
  /** Montant affiché / enregistré de la consultation (unité majeure). */
  amount: number;
  /** Devise ISO (`consultations.currency`). */
  currency: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  payItemName: string;
}

export interface PendingPaymentWidget {
  config: InlineCheckoutConfig;
  request: InlineCheckoutRequest;
}

type WidgetOutcome = Awaited<ReturnType<OpenPaymentWidget>>;
type PendingEntry = PendingPaymentWidget & { resolve: (r: WidgetOutcome) => void; reject: (e: Error) => void };

/** Demandes en cours, indexées par `txnRef` : un résultat pour A ne peut jamais régler B. */
const pending = new Map<string, PendingEntry>();

/** Demande de paiement en cours pour cette `txnRef`, lue par `app/payment.tsx`. */
export function getPendingPaymentWidget(txnRef: string | undefined): PendingPaymentWidget | null {
  const entry = txnRef ? pending.get(txnRef) : undefined;
  return entry ? { config: entry.config, request: entry.request } : null;
}

export type PaymentWidgetPreflight = { ok: true } | { ok: false; reason: 'not_configured' | 'unsupported_currency' };

/**
 * Vérifie, AVANT l'insertion d'une consultation `pending_payment`, que le widget pourra s'ouvrir :
 * configuration présente et devise connue (même validation que `createOpenPaymentWidget`).
 */
export function paymentWidgetPreflight(
  currency: string | null | undefined,
  config: InlineCheckoutConfig | null = getPaymentWidgetConfig(),
): PaymentWidgetPreflight {
  if (!config) return { ok: false, reason: 'not_configured' };
  if (!currency || currencyNumericCode(currency) === null) return { ok: false, reason: 'unsupported_currency' };
  return { ok: true };
}

/**
 * Issue du widget pour la demande `txnRef`, rapportée par l'écran de paiement. `success` →
 * `{ status: 'success', payRef }` ; `paid_unconfirmed` → `{ status: 'paid_unconfirmed' }` (débité, sans
 * `payRef`) ; `cancelled` / `declined` (explicites) → `{ status: 'cancelled' }` ; `dismissed` (écran quitté,
 * retour passerelle sans résultat, timeout) → `{ status: 'dismissed', reason }`, la tentative est conservée ; `error` → `PaymentWidgetUnavailableError`. Une `txnRef` inconnue ne règle rien.
 */
export function settlePaymentWidget(txnRef: string, message: WidgetMessage): void {
  const entry = pending.get(txnRef);
  if (!entry || message.kind === 'ignore') return;
  pending.delete(txnRef);
  if (message.kind === 'success') entry.resolve({ status: 'success', payRef: message.payRef });
  else if (message.kind === 'paid_unconfirmed') entry.resolve({ status: 'paid_unconfirmed' });
  else if (message.kind === 'error') entry.reject(new PaymentWidgetUnavailableError(message.desc));
  else if (message.kind === 'dismissed') entry.resolve({ status: 'dismissed', reason: message.reason });
  else entry.resolve({ status: 'cancelled' }); // cancelled / declined : explicites et définitifs
}

/**
 * Fabrique l'`openPaymentWidget(txnRef)` injecté dans `payConsultation` : ouvre l'écran `/payment`
 * et attend que la WebView rapporte le résultat.
 */
export function createOpenPaymentWidget(
  details: PaymentWidgetDetails,
  options: { config?: InlineCheckoutConfig | null } = {},
): OpenPaymentWidget {
  return (txnRef) => {
    const config = options.config === undefined ? getPaymentWidgetConfig() : options.config;
    const check = paymentWidgetPreflight(details.currency, config);
    if (!check.ok) {
      return Promise.reject(
        new PaymentWidgetUnavailableError(check.reason === 'unsupported_currency' ? details.currency : undefined),
      );
    }
    const currencyNumeric = currencyNumericCode(details.currency)!;
    return new Promise((resolve, reject) => {
      // Un seul widget à l'écran : toute demande précédente jamais terminée est abandonnée (= annulée).
      for (const [oldRef, old] of [...pending]) {
        pending.delete(oldRef);
        old.resolve({ status: 'dismissed', reason: 'user_left' }); // pas un refus explicite : tentative conservée
      }
      pending.set(txnRef, {
        config: config!,
        request: {
          txnRef,
          amount: toSmallestUnit(details.amount, details.currency),
          currencyNumeric,
          customerId: details.customerId,
          customerName: details.customerName,
          customerEmail: details.customerEmail,
          payItemName: details.payItemName,
        },
        resolve,
        reject,
      });
      router.push({ pathname: '/payment', params: { txnRef } });
    });
  };
}
