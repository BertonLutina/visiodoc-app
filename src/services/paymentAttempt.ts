import { supabase } from '@/lib/supabase';
import { translate } from '@/i18n/core';
import { edgeFunctionError } from '@/utils/authError';
import { reportSessionExpiry } from './sessionExpiry';
import { clearPendingAttempt, getPendingAttempt, listPendingAttempts, savePendingAttempt } from './pendingPaymentAttempt';
import type { PendingPaymentAttempt } from './pendingPaymentAttempt';

/* ------------------------------------------------------------------------------------------------
 * Paiement d'une consultation sous le verrou serveur `consultation_payment_lock` (guide, étape 3) :
 *   consultation `pending_payment` → register-payment-attempt → widget MultiPay → confirm-consultation-payment.
 * Le client n'écrit JAMAIS payment_status / payment_amount / currency / payment_reference /
 * fee_percent_at_booking, ni `status = 'scheduled'` : seule `confirm-consultation-payment` (service_role)
 * le fait. `supabase.functions.invoke` envoie `Authorization: Bearer <session>` + `apikey`.
 * Ce module reste volontairement modulaire : les paiements prestataire (abonnement / avoir) viennent s'y ajouter.
 * ---------------------------------------------------------------------------------------------- */

/** Résultat du widget de paiement (injecté : voir `src/services/paymentWidget.ts`). */
export type PaymentWidgetResult =
  | { status: 'success'; payRef: string }
  /** Le patient a été débité (`resp 00`) mais le widget n'a pas rendu de `payRef`. */
  | { status: 'paid_unconfirmed' }
  | { status: 'cancelled' };

/** Ouvre le widget avec la référence de transaction et attend son issue. */
export type OpenPaymentWidget = (txnRef: string) => Promise<PaymentWidgetResult>;

export type PaymentNotPayableCode = 'NOT_PAYABLE' | 'TXN_ALREADY_USED';

/** Au-delà de ce délai sans issue, une tentative sans `payRef` peut être reprise explicitement (le serveur libère le créneau). */
export const PAYMENT_ATTEMPT_STALE_MS = 15 * 60_000;

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
  constructor(message?: string) {
    super(
      message ??
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

type InvokeResult = { data: any; error: any };

const sessionExpiredError = () =>
  new PaymentRegistrationError(401, translate('Ta session a expiré, reconnecte-toi.'));

/** Rafraîchit la session une fois ; un échec = session expirée (signalée à l'app, qui purge la session). */
async function refreshSessionOnce(): Promise<boolean> {
  try {
    const { error } = await supabase!.auth.refreshSession();
    if (!error) return true;
    reportSessionExpiry(error) || reportSessionExpiry({ code: 'session_expired' });
  } catch (e) {
    reportSessionExpiry(e) || reportSessionExpiry({ code: 'session_expired' });
  }
  return false;
}

/**
 * `POST /functions/v1/register-payment-attempt` `{ consultationId, txnRef, useWallet }`.
 * - 200 `{ success: true }` → ok.
 * - `NOT_PAYABLE` / `TXN_ALREADY_USED` (corps 200 `success:false` ou HTTP 409) → `PaymentNotPayableError`.
 * - Erreur réseau, 429, 5xx (dont 503) → ne bloque PAS le paiement (le rattrapage serveur sera simplement absent).
 * - 401 (jeton expiré) → rafraîchit la session UNE fois et rejoue UNE fois ; refresh en échec = session
 *   expirée (signalée via `reportSessionExpiry`), on bloque.
 * - 400 / 403 / 404 → `PaymentRegistrationError` : on BLOQUE.
 *
 * Écart volontaire avec le guide (qui ne cite que NOT_PAYABLE / TXN_ALREADY_USED comme bloquants) : un
 * enregistrement définitivement refusé est condamné, `confirm-consultation-payment` échouerait de la même
 * façon APRÈS que le patient a payé. Mieux vaut ne pas ouvrir le widget que débiter un patient sans pouvoir
 * confirmer.
 */
export async function registerConsultationPayment(
  consultationId: string,
  txnRef: string,
  useWallet = false,
): Promise<void> {
  const call = async (): Promise<InvokeResult | null> => {
    try {
      return await supabase!.functions.invoke('register-payment-attempt', {
        body: { consultationId, txnRef, useWallet },
      });
    } catch {
      return null; // hors ligne : le paiement continue
    }
  };

  let result = await call();
  if (!result) return;
  let refreshed = false;
  for (;;) {
    const { data, error } = result;
    if (error) {
      const { status, body } = await readHttpError(error);
      if (isNotPayableCode(body?.code)) throw new PaymentNotPayableError(body.code);
      if (status === 401) {
        if (refreshed) throw new PaymentRegistrationError(401, edgeFunctionError(body, error?.message).message);
        refreshed = true;
        if (!(await refreshSessionOnce())) throw sessionExpiredError();
        const retry = await call();
        if (!retry) return;
        result = retry;
        continue;
      }
      if (status === undefined || status === 429 || status >= 500) return;
      throw new PaymentRegistrationError(status, edgeFunctionError(body, error?.message).message);
    }
    if (data?.success === false) {
      if (isNotPayableCode(data.code)) throw new PaymentNotPayableError(data.code);
      throw new PaymentRegistrationError(undefined, edgeFunctionError(data).message);
    }
    return;
  }
}

const withContext = <E extends PaymentConfirmationError>(err: E, consultationId: string, txnRef: string): E => {
  err.consultationId = consultationId;
  err.txnRef = txnRef;
  return err;
};

/**
 * `POST /functions/v1/confirm-consultation-payment` `{ consultationId, txnRef, payRef, useWallet }`.
 * Le serveur met `status = 'scheduled'` et `payment_status = 'paid'` ; l'appelant relit la consultation.
 * `NOT_PAYABLE` (déjà traitée côté serveur) → `PaymentNotPayableError` ; tout autre échec → `PaymentConfirmationError`.
 */
export async function confirmConsultationPayment(
  consultationId: string,
  txnRef: string,
  payRef: string,
  useWallet = false,
): Promise<void> {
  let result: InvokeResult;
  try {
    result = await supabase!.functions.invoke('confirm-consultation-payment', {
      body: { consultationId, txnRef, payRef, useWallet },
    });
  } catch {
    throw withContext(new PaymentConfirmationError(), consultationId, txnRef);
  }
  if (result.error) {
    const { body } = await readHttpError(result.error);
    if (body?.code === 'NOT_PAYABLE') throw new PaymentNotPayableError('NOT_PAYABLE');
    throw withContext(new PaymentConfirmationError(), consultationId, txnRef);
  }
  if (result.data?.success === false) {
    if (result.data.code === 'NOT_PAYABLE') throw new PaymentNotPayableError('NOT_PAYABLE');
    throw withContext(new PaymentConfirmationError(), consultationId, txnRef);
  }
}

/* ---------- Relecture de la consultation (état serveur, jamais d'état local) ---------- */

export interface ConsultationPaymentState {
  status: string;
  paymentStatus: string | null;
  scheduledAt: string | null;
}

/** Lit `status` / `payment_status` en base ; `null` si la ligne n'est pas visible. Lève en cas d'erreur de lecture. */
export async function readConsultationPayment(consultationId: string): Promise<ConsultationPaymentState | null> {
  const { data, error } = await supabase!
    .from('consultations')
    .select('id, status, payment_status, scheduled_at')
    .eq('id', consultationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { status: data.status, paymentStatus: data.payment_status ?? null, scheduledAt: data.scheduled_at ?? null };
}

const readSafe = (consultationId: string) => readConsultationPayment(consultationId).catch(() => null);
const isPaid = (row: ConsultationPaymentState) => row.paymentStatus === 'paid';

/** Rejoue `confirm` avec la MÊME `txnRef` / `payRef` mémorisées. `handled` = le serveur répond NOT_PAYABLE (déjà traité). */
async function confirmStoredAttempt(a: PendingPaymentAttempt, useWallet: boolean): Promise<'paid' | 'handled'> {
  try {
    await confirmConsultationPayment(a.consultationId, a.txnRef, a.payRef!, useWallet);
  } catch (e) {
    if (e instanceof PaymentNotPayableError) {
      await clearPendingAttempt(a.consultationId);
      return 'handled';
    }
    throw e;
  }
  const row = await readSafe(a.consultationId);
  if (row && isPaid(row)) {
    await clearPendingAttempt(a.consultationId);
    return 'paid';
  }
  // Confirmé mais la base ne l'affiche pas (encore) : on garde la tentative pour la prochaine reprise.
  throw withContext(new PaymentConfirmationError(), a.consultationId, a.txnRef);
}

export type PayConsultationResult =
  | { status: 'confirmed'; txnRef: string }
  | { status: 'cancelled'; txnRef: string };

/**
 * Ordre imposé : nouvelle `txnRef` → `register-payment-attempt` (une seule régénération si `TXN_ALREADY_USED`,
 * jamais pour `NOT_PAYABLE`) → tentative mémorisée (sans `payRef`) → widget → (succès) tentative mémorisée avec
 * `payRef` PUIS `confirm-consultation-payment` → relecture en base ; la tentative n'est effacée qu'une fois la
 * ligne `paid`. Annulation du widget : aucune confirmation, aucune écriture, tentative effacée ; la
 * consultation reste `pending_payment`. Débité sans `payRef` : la tentative reste, on lève un message « ne repaie pas ».
 */
export async function payConsultation(input: {
  consultationId: string;
  openPaymentWidget: OpenPaymentWidget;
  useWallet?: boolean;
}): Promise<PayConsultationResult> {
  const { consultationId, openPaymentWidget, useWallet = false } = input;
  let txnRef = generateTxnRef();
  try {
    await registerConsultationPayment(consultationId, txnRef, useWallet);
  } catch (e) {
    if (!(e instanceof PaymentNotPayableError && e.code === 'TXN_ALREADY_USED')) throw e;
    txnRef = generateTxnRef();
    await registerConsultationPayment(consultationId, txnRef, useWallet); // 2e TXN_ALREADY_USED : bloque
  }

  // Dès l'ouverture : un arrêt de l'app en plein paiement reste détectable (txnRef seule, sans payRef).
  await savePendingAttempt({ consultationId, txnRef });
  let outcome: PaymentWidgetResult;
  try {
    outcome = await openPaymentWidget(txnRef);
  } catch (e) {
    await clearPendingAttempt(consultationId); // le widget n'a pas pu démarrer : rien n'a été débité
    throw e;
  }
  if (outcome.status === 'cancelled') {
    await clearPendingAttempt(consultationId);
    return { status: 'cancelled', txnRef };
  }
  if (outcome.status === 'paid_unconfirmed') {
    throw withContext(
      new PaymentConfirmationError(translate('Paiement effectué, ne repaie pas. Nous vérifions ta transaction.')),
      consultationId,
      txnRef,
    );
  }

  const attempt = { consultationId, txnRef, payRef: outcome.payRef };
  await savePendingAttempt(attempt); // AVANT confirm
  const stored = (await getPendingAttempt(consultationId)) ?? { ...attempt, at: Date.now() };
  const result = await confirmStoredAttempt(stored, useWallet);
  if (result === 'handled') {
    const row = await readSafe(consultationId);
    if (row && isPaid(row)) return { status: 'confirmed', txnRef };
    throw new PaymentNotPayableError('NOT_PAYABLE');
  }
  return { status: 'confirmed', txnRef };
}

export type PayExistingResult =
  | PayConsultationResult
  | { status: 'already_paid' }
  /** Tentative incertaine (sans `payRef`) : ne pas rouvrir de widget. `canOverride` : plus de 15 min, reprise explicite possible. */
  | { status: 'verifying'; canOverride: boolean };

/**
 * Repaie une consultation déjà créée. Relit d'abord la ligne (déjà payée → refus ; plus `pending_payment` →
 * NOT_PAYABLE), rejoue `confirm` si une tentative AVEC `payRef` est mémorisée (même `txnRef` / `payRef`), ne
 * rouvre PAS de widget si une tentative SANS `payRef` est mémorisée (sauf `override` explicite après 15 min),
 * sinon retombe sur `payConsultation` avec une NOUVELLE `txnRef`.
 */
export async function payExistingConsultation(input: {
  consultationId: string;
  openPaymentWidget: OpenPaymentWidget;
  useWallet?: boolean;
  override?: boolean;
}): Promise<PayExistingResult> {
  const { consultationId, openPaymentWidget, useWallet = false, override = false } = input;
  const row = await readConsultationPayment(consultationId);
  if (!row) throw new PaymentNotPayableError('NOT_PAYABLE');
  if (isPaid(row)) {
    await clearPendingAttempt(consultationId);
    return { status: 'already_paid' };
  }
  if (row.status !== 'pending_payment') throw new PaymentNotPayableError('NOT_PAYABLE');

  const attempt = await getPendingAttempt(consultationId);
  if (attempt?.payRef) {
    const outcome = await confirmStoredAttempt(attempt, useWallet);
    if (outcome === 'paid') return { status: 'confirmed', txnRef: attempt.txnRef };
    const after = await readSafe(consultationId);
    if (after && isPaid(after)) return { status: 'confirmed', txnRef: attempt.txnRef };
    if (after && after.status !== 'pending_payment') throw new PaymentNotPayableError('NOT_PAYABLE');
  } else if (attempt) {
    const canOverride = Date.now() - attempt.at >= PAYMENT_ATTEMPT_STALE_MS;
    if (!(override && canOverride)) return { status: 'verifying', canOverride };
    await clearPendingAttempt(consultationId);
  }
  return payConsultation({ consultationId, openPaymentWidget, useWallet });
}

/**
 * Au retour sur « Mes consultations » : pour chaque tentative mémorisée, relit la ligne ; payée → on oublie la
 * tentative ; `pending_payment` avec `payRef` → on rejoue `confirm` (même `txnRef` / `payRef`). Une tentative sans
 * `payRef` n'est jamais confirmée ici. Ne lève jamais.
 */
export async function reconcilePendingPayments(): Promise<void> {
  for (const attempt of await listPendingAttempts()) {
    try {
      const row = await readConsultationPayment(attempt.consultationId);
      if (!row) continue;
      if (isPaid(row)) await clearPendingAttempt(attempt.consultationId);
      else if (row.status === 'pending_payment' && attempt.payRef) await confirmStoredAttempt(attempt, false);
    } catch {
      /* réessayé au prochain retour sur l'écran */
    }
  }
}
