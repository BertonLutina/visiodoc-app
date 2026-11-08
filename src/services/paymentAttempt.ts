import { supabase } from '@/lib/supabase';
import { translate } from '@/i18n/core';
import { edgeFunctionError } from '@/utils/authError';

/* ------------------------------------------------------------------------------------------------
 * Paiement d'une consultation sous le verrou serveur `consultation_payment_lock` (guide, étape 3) :
 *   consultation `pending_payment` → register-payment-attempt → widget MultiPay → confirm-consultation-payment.
 * Le client n'écrit JAMAIS payment_status / payment_amount / currency / payment_reference /
 * fee_percent_at_booking, ni `status = 'scheduled'` : seule `confirm-consultation-payment` (service_role)
 * le fait. `supabase.functions.invoke` envoie `Authorization: Bearer <session>` + `apikey`.
 * Ce module reste volontairement modulaire : les paiements prestataire (abonnement / avoir) viennent s'y ajouter.
 * ---------------------------------------------------------------------------------------------- */

/** Résultat du widget de paiement (injecté : voir `src/services/paymentWidget.ts`). */
export type PaymentWidgetResult = { status: 'success'; payRef: string } | { status: 'cancelled' };

/** Ouvre le widget avec la référence de transaction et attend son issue. */
export type OpenPaymentWidget = (txnRef: string) => Promise<PaymentWidgetResult>;

export type PaymentNotPayableCode = 'NOT_PAYABLE' | 'TXN_ALREADY_USED';

/** `register-payment-attempt` a refusé : le widget ne doit pas s'ouvrir. */
export class PaymentNotPayableError extends Error {
  code: PaymentNotPayableCode;
  /** Renseigné par `bookAndPayConsultation` : consultation créée mais impayée. */
  consultationId?: string;
  constructor(code: PaymentNotPayableCode) {
    super(
      code === 'NOT_PAYABLE'
        ? translate("Cette consultation ne peut plus être payée. Vérifie tes rendez-vous.")
        : translate('Cette référence de paiement a déjà été utilisée. Réessaie le paiement.'),
    );
    this.name = 'PaymentNotPayableError';
    this.code = code;
  }
}

/** `register-payment-attempt` refusé de façon définitive (400 / 401 / 403 / 404…) : on ne paie pas. */
export class PaymentRegistrationError extends Error {
  status?: number;
  consultationId?: string;
  constructor(status: number | undefined, message: string) {
    super(message);
    this.name = 'PaymentRegistrationError';
    this.status = status;
  }
}

/** Paiement effectué côté widget mais `confirm-consultation-payment` a échoué : ne pas repayer. */
export class PaymentConfirmationError extends Error {
  consultationId?: string;
  txnRef?: string;
  constructor() {
    super(
      translate(
        "Ton paiement a bien été effectué, mais sa confirmation n'est pas encore arrivée. Ne paie pas une seconde fois : vérifie tes rendez-vous dans quelques instants.",
      ),
    );
    this.name = 'PaymentConfirmationError';
  }
}

/** Référence de transaction : même forme que le web (`VDC-<timestamp>-<7 car. A-Z0-9>`), 25 caractères. */
export const generateTxnRef = (): string => {
  const random = Math.random().toString(36).substring(2, 9).toUpperCase().padEnd(7, '0');
  return `VDC-${Date.now()}-${random}`;
};

const isNotPayableCode = (code: unknown): code is PaymentNotPayableCode =>
  code === 'NOT_PAYABLE' || code === 'TXN_ALREADY_USED';

/** Statut HTTP + corps JSON d'une `FunctionsHttpError` (la `Response` est dans `error.context`). */
async function readHttpError(error: any): Promise<{ status: number | undefined; body: any }> {
  const response = error?.context;
  const status: number | undefined = typeof response?.status === 'number' ? response.status : undefined;
  let body: any = null;
  try {
    body = await response?.json?.();
  } catch {
    /* corps absent ou illisible */
  }
  return { status, body };
}

/**
 * `POST /functions/v1/register-payment-attempt` `{ consultationId, txnRef, useWallet }`.
 * - 200 `{ success: true }` → ok.
 * - `NOT_PAYABLE` / `TXN_ALREADY_USED` (corps 200 `success:false` ou HTTP 409) → `PaymentNotPayableError`.
 * - Erreur réseau, 429, 5xx (dont 503) → ne bloque PAS le paiement (le rattrapage serveur sera simplement absent).
 * - Autre refus HTTP définitif (400/401/403/404) → `PaymentRegistrationError` : la confirmation échouerait aussi.
 */
export async function registerConsultationPayment(
  consultationId: string,
  txnRef: string,
  useWallet = false,
): Promise<void> {
  let result: { data: any; error: any };
  try {
    result = await supabase!.functions.invoke('register-payment-attempt', {
      body: { consultationId, txnRef, useWallet },
    });
  } catch {
    return; // hors ligne : le paiement continue
  }
  const { data, error } = result;

  if (error) {
    const { status, body } = await readHttpError(error);
    if (isNotPayableCode(body?.code)) throw new PaymentNotPayableError(body.code);
    if (status === undefined || status === 429 || status >= 500) return;
    throw new PaymentRegistrationError(status, edgeFunctionError(body, error?.message).message);
  }
  if (data?.success === false) {
    if (isNotPayableCode(data.code)) throw new PaymentNotPayableError(data.code);
    throw new PaymentRegistrationError(undefined, edgeFunctionError(data).message);
  }
}

/**
 * `POST /functions/v1/confirm-consultation-payment` `{ consultationId, txnRef, payRef, useWallet }`.
 * Le serveur met `status = 'scheduled'` et `payment_status = 'paid'` ; l'appelant relit la consultation.
 */
export async function confirmConsultationPayment(
  consultationId: string,
  txnRef: string,
  payRef: string,
  useWallet = false,
): Promise<void> {
  let result: { data: any; error: any };
  try {
    result = await supabase!.functions.invoke('confirm-consultation-payment', {
      body: { consultationId, txnRef, payRef, useWallet },
    });
  } catch {
    throw withContext(new PaymentConfirmationError(), consultationId, txnRef);
  }
  if (result.error || result.data?.success === false) {
    throw withContext(new PaymentConfirmationError(), consultationId, txnRef);
  }
}

const withContext = (err: PaymentConfirmationError, consultationId: string, txnRef: string) => {
  err.consultationId = consultationId;
  err.txnRef = txnRef;
  return err;
};

export type PayConsultationResult =
  | { status: 'confirmed'; txnRef: string }
  | { status: 'cancelled'; txnRef: string };

/**
 * Ordre imposé : nouvelle `txnRef` → `register-payment-attempt` → widget → (succès) `confirm-consultation-payment`.
 * Sert aussi à repayer une consultation déjà `pending_payment` (chaque appel génère une NOUVELLE `txnRef`).
 * Annulation du widget : aucune confirmation, aucune écriture ; la consultation reste `pending_payment`.
 */
export async function payConsultation(input: {
  consultationId: string;
  openPaymentWidget: OpenPaymentWidget;
  useWallet?: boolean;
}): Promise<PayConsultationResult> {
  const { consultationId, openPaymentWidget, useWallet = false } = input;
  const txnRef = generateTxnRef();
  await registerConsultationPayment(consultationId, txnRef, useWallet);
  const outcome = await openPaymentWidget(txnRef);
  if (outcome.status !== 'success') return { status: 'cancelled', txnRef };
  await confirmConsultationPayment(consultationId, txnRef, outcome.payRef, useWallet);
  return { status: 'confirmed', txnRef };
}
