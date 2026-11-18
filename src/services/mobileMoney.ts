import { supabase } from '@/lib/supabase';
import { translate } from '@/i18n/core';
import { readHttpError } from '@/utils/authError';

export type MobileWalletProvider = 'ORANGE' | 'MPESA' | 'AIRTELMONEY' | 'AFRIMONEY';

export const MOBILE_WALLET_PROVIDERS: readonly MobileWalletProvider[] = [
  'ORANGE',
  'MPESA',
  'AIRTELMONEY',
  'AFRIMONEY',
];

export const OPERATOR_LABELS: Record<MobileWalletProvider, string> = {
  ORANGE: 'Orange Money',
  MPESA: 'Vodacom M-Pesa',
  AIRTELMONEY: 'Airtel Money',
  AFRIMONEY: 'Africell Afrimoney',
};

const PREFIXES: Record<MobileWalletProvider, string[]> = {
  ORANGE: ['084', '085', '089'],
  MPESA: ['081', '082', '083'],
  AIRTELMONEY: ['097', '098', '099'],
  AFRIMONEY: ['090', '091'],
};

const KNOWN_CONGOLESE_BARE_PREFIXES = new Set([
  '81',
  '82',
  '83',
  '84',
  '85',
  '89',
  '90',
  '97',
  '98',
  '99',
]);

export type MobileMoneyTarget =
  | { kind: 'consultation'; consultationId: string; useWallet?: boolean }
  | { kind: 'subscription'; subscriptionId: string }
  | { kind: 'wallet_recharge'; quantity: 5 | 10 | 20 | 50 | 100; currency: 'USD' | 'CDF' };

export type MobileMoneyState = 'pending' | 'paid' | 'expired' | 'failed' | 'review' | 'unknown';

export interface InitiateMobileMoneyResult {
  success: boolean;
  txnRef?: string;
  operator?: MobileWalletProvider;
  pending?: boolean;
  alreadyPaid?: boolean;
  nothingToPay?: boolean;
  operatorRequired?: boolean;
  providerUnreachable?: boolean;
  code?: string;
  error?: string;
}

export interface MobileMoneyStatusResult {
  success: boolean;
  state?: MobileMoneyState;
  providerCode?: string;
  ageSeconds?: number;
  code?: string;
  error?: string;
}

export interface WalletRechargePrice {
  unitPrice: number;
  priceCurrency: string;
  source: 'country' | 'legacy';
}

/**
 * Normalise un numéro mobile congolais (RDC, +243) et vérifie la règle `^[89]\d{8}$` sur les 9 chiffres nationaux.
 * Formes acceptées avec indicatif : `+243...`, `00243...`, `243...`, `+2430...`.
 * Formes sans indicatif : préfixes congolais connus (`81, 82, 83, 84, 85, 89, 90, 97, 98, 99`) ou `091...` avec le 0 initial.
 */
export function normalizeCongoleseMobileMoneyPhone(
  input: unknown,
): { msisdn: string; national: string; local9: string } | null {
  if (typeof input !== 'string') return null;
  let digits = input.replace(/[^\d]/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);

  let hasDialCode = false;
  let hadLeadingZeroWithoutDialCode = false;

  if (digits.startsWith('2430') && digits.length === 13) {
    digits = digits.slice(4);
    hasDialCode = true;
  } else if (digits.startsWith('243') && digits.length === 12) {
    digits = digits.slice(3);
    hasDialCode = true;
  } else if (digits.startsWith('0') && digits.length === 10) {
    digits = digits.slice(1);
    hadLeadingZeroWithoutDialCode = true;
  }

  if (!/^[89]\d{8}$/.test(digits)) return null;

  if (!hasDialCode) {
    const prefix2 = digits.slice(0, 2);
    const allowedWithLeadingZero = hadLeadingZeroWithoutDialCode && prefix2 === '91';
    if (!KNOWN_CONGOLESE_BARE_PREFIXES.has(prefix2) && !allowedWithLeadingZero) {
      return null;
    }
  }

  return { msisdn: `243${digits}`, national: `0${digits}`, local9: digits };
}

/**
 * Préremplit le champ Mobile Money uniquement si le téléphone du profil est congolais.
 * Un compte à numéro étranger (ex. +32...) ou vide laisse le champ vide (indicatif +243 fixe).
 * Ne se base jamais sur le pays du compte.
 */
export function resolveMobileMoneyPrefillPhone(userPhone: unknown): string {
  const normalized = normalizeCongoleseMobileMoneyPhone(userPhone);
  return normalized ? normalized.national : '';
}

export function detectLocalOperator(phone: string): MobileWalletProvider | null {
  const normalized = normalizeCongoleseMobileMoneyPhone(phone);
  if (normalized) {
    const prefix = normalized.national.slice(0, 3);
    for (const op of MOBILE_WALLET_PROVIDERS) {
      if (PREFIXES[op].includes(prefix)) return op;
    }
    return null;
  }
  const digits = phone.replace(/[^\d]/g, '');
  let national = '';
  if (digits.startsWith('243') && digits.length >= 5) national = `0${digits.slice(3)}`;
  else if (digits.startsWith('0') && digits.length >= 3) national = digits;
  else if (digits.length >= 2 && !digits.startsWith('91')) national = `0${digits}`;
  if (national.length >= 3) {
    const prefix = national.slice(0, 3);
    for (const op of MOBILE_WALLET_PROVIDERS) {
      if (PREFIXES[op].includes(prefix)) return op;
    }
  }
  return null;
}

function mapInitiateErrorMessage(code?: string, status?: number): string {
  switch (code) {
    case 'INVALID_PHONE':
      return translate('Numéro de téléphone invalide');
    case 'OPERATOR_REQUIRED':
      return translate('Sélectionne ton opérateur Mobile Money pour continuer.');
    case 'NOT_PAYABLE':
      return translate('Ce paiement ne peut plus être effectué.');
    case 'SIMULATION_ONLY':
      return translate('Le paiement Mobile Money est indisponible en mode simulation.');
    case 'FORBIDDEN':
      return translate("Tu n'es pas autorisé à effectuer ce paiement.");
    case 'INVALID_REQUEST':
      return translate('Demande de paiement invalide.');
    case 'PROVIDER_REJECTED':
      return translate('Le service Mobile Money a refusé la demande. Vérifie ton numéro et réessaie.');
    case 'PROVIDER_UNREACHABLE':
      return translate('Le service Mobile Money met du temps à répondre. Vérifie ton téléphone avant de réessayer.');
    case 'PAYMENT_NOT_CONFIGURED':
      return translate("Le paiement n'est pas configuré pour le moment.");
    default:
      if (status === 401) return translate('Ta session a expiré, reconnecte-toi.');
      if (status === 429) return translate('Trop de tentatives. Réessaie dans quelques minutes.');
      if (status === 404) return translate('Paiement introuvable.');
      if (status === 503) return translate('Le service Mobile Money met du temps à répondre. Vérifie ton téléphone avant de réessayer.');
      return translate("Impossible d'initier la demande Mobile Money. Réessaie.");
  }
}

export async function initiateMobileMoneyPayment(params: {
  target: MobileMoneyTarget;
  phone: string;
  operator?: MobileWalletProvider;
}): Promise<InitiateMobileMoneyResult> {
  const normalized = normalizeCongoleseMobileMoneyPhone(params.phone);
  if (!normalized) {
    return {
      success: false,
      code: 'INVALID_PHONE',
      error: translate('Numéro de téléphone invalide'),
    };
  }

  if (!supabase) {
    return {
      success: false,
      code: 'PAYMENT_NOT_CONFIGURED',
      error: translate("Le paiement n'est pas configuré pour le moment."),
    };
  }

  const body: Record<string, unknown> = {
    phone: normalized.msisdn,
    ...(params.operator ? { operator: params.operator } : {}),
  };

  if (params.target.kind === 'consultation') {
    body.kind = 'consultation';
    body.consultationId = params.target.consultationId;
    body.useWallet = Boolean(params.target.useWallet);
  } else if (params.target.kind === 'subscription') {
    body.kind = 'subscription';
    body.subscriptionId = params.target.subscriptionId;
  } else {
    body.kind = 'wallet_recharge';
    body.quantity = params.target.quantity;
    body.currency = params.target.currency;
  }

  try {
    const { data, error } = await supabase.functions.invoke('mobile-money-initiate', { body });
    if (error) {
      const { status, body: errBody } = await readHttpError(error);
      const code = typeof errBody?.code === 'string' ? errBody.code : undefined;
      return {
        success: false,
        code,
        operatorRequired: code === 'OPERATOR_REQUIRED' || status === 422,
        providerUnreachable: code === 'PROVIDER_UNREACHABLE' || status === 503,
        error: mapInitiateErrorMessage(code, status),
      };
    }

    if (data?.success === false) {
      const code = typeof data.code === 'string' ? data.code : undefined;
      return {
        success: false,
        code,
        operatorRequired: code === 'OPERATOR_REQUIRED',
        providerUnreachable: code === 'PROVIDER_UNREACHABLE',
        error: mapInitiateErrorMessage(code),
      };
    }

    return {
      success: true,
      txnRef: data?.txnRef,
      operator: data?.operator,
      pending: Boolean(data?.pending),
      alreadyPaid: Boolean(data?.alreadyPaid),
      nothingToPay: Boolean(data?.nothingToPay),
    };
  } catch {
    return {
      success: false,
      code: 'PROVIDER_UNREACHABLE',
      providerUnreachable: true,
      error: mapInitiateErrorMessage('PROVIDER_UNREACHABLE', 503),
    };
  }
}

export async function getMobileMoneyStatus(txnRef: string): Promise<MobileMoneyStatusResult> {
  if (!supabase) {
    return { success: false, error: translate("Le paiement n'est pas configuré pour le moment.") };
  }
  try {
    const { data, error } = await supabase.functions.invoke('mobile-money-status', {
      body: { txnRef },
    });
    if (error) {
      const { status, body: errBody } = await readHttpError(error);
      const code = typeof errBody?.code === 'string' ? errBody.code : undefined;
      return {
        success: false,
        code,
        error:
          status === 404
            ? translate('Paiement introuvable.')
            : translate('Impossible de vérifier le statut du paiement.'),
      };
    }
    return {
      success: Boolean(data?.success),
      state: data?.state,
      providerCode: data?.providerCode,
      ageSeconds: data?.ageSeconds,
    };
  } catch {
    return { success: false, error: translate('Impossible de vérifier le statut du paiement.') };
  }
}

export interface MobileMoneyPollerOptions {
  txnRef: string;
  onState?: (state: MobileMoneyState, res: MobileMoneyStatusResult) => void;
  onPaid: (txnRef: string) => void;
  onTerminal?: (state: Exclude<MobileMoneyState, 'pending' | 'unknown' | 'paid'>, res: MobileMoneyStatusResult) => void;
  intervalMs?: number;
  initialDelayMs?: number;
}

/**
 * Démarre le sondage `mobile-money-status` avec arrêt propre au démontage et garantie d'un seul passage au succès.
 */
export function startMobileMoneyStatusPolling(options: MobileMoneyPollerOptions): { stop: () => void } {
  const intervalMs = options.intervalMs ?? 4000;
  const initialDelayMs = options.initialDelayMs ?? 2000;
  let stopped = false;
  let paidHandled = false;
  let terminalHandled = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let initialTimer: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    stopped = true;
    if (initialTimer) {
      clearTimeout(initialTimer);
      initialTimer = null;
    }
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  const tick = async () => {
    if (stopped || paidHandled || terminalHandled) return;
    const res = await getMobileMoneyStatus(options.txnRef);
    if (stopped || !res.success || !res.state) return;

    options.onState?.(res.state, res);

    if (res.state === 'paid') {
      if (!paidHandled) {
        paidHandled = true;
        stop();
        options.onPaid(options.txnRef);
      }
      return;
    }

    if (res.state === 'expired' || res.state === 'failed' || res.state === 'review') {
      if (!terminalHandled) {
        terminalHandled = true;
        stop();
        options.onTerminal?.(res.state, res);
      }
    }
  };

  initialTimer = setTimeout(() => {
    void tick();
    if (!stopped) {
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
    }
  }, initialDelayMs);

  return { stop };
}

/**
 * Lit le prix de recharge d'appels IA du pays du prestataire via `get_my_wallet_recharge_price()` (MOB-0911-1).
 * Ne lit jamais `site_settings.ai_call_unit_price`.
 */
export async function getMyWalletRechargePrice(): Promise<WalletRechargePrice | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_my_wallet_recharge_price');
  if (error || !data) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  const unitPrice = Number(row.unit_price);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;
  return {
    unitPrice,
    priceCurrency: String(row.price_currency || 'CDF').toUpperCase(),
    source: row.source === 'country' ? 'country' : 'legacy',
  };
}

export function computeWalletRechargeTotal(
  unitPrice: number,
  quantity: number,
  priceCurrency: string,
  payCurrency: string,
  ratesToUsd?: Record<string, number>,
): { amount: number; currency: string } | { error: string } {
  const baseTotal = unitPrice * quantity;
  const pCur = priceCurrency.toUpperCase();
  const targetCur = payCurrency.toUpperCase();
  if (pCur === targetCur) {
    return { amount: baseTotal, currency: targetCur };
  }
  const rateFrom = pCur === 'USD' ? 1 : ratesToUsd?.[pCur];
  const rateTo = targetCur === 'USD' ? 1 : ratesToUsd?.[targetCur];
  if (!rateFrom || !rateTo || rateFrom <= 0 || rateTo <= 0) {
    return { error: translate('Taux de change non configuré pour cette devise.') };
  }
  return { amount: (baseTotal / rateFrom) * rateTo, currency: targetCur };
}
