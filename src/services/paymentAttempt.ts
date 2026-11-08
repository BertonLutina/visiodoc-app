import { supabase } from '@/lib/supabase';
import { translate } from '@/i18n/core';
import { edgeFunctionError, readHttpError } from '@/utils/authError';
import { reportSessionExpiry } from './sessionExpiry';
import {
  clearPendingAttempt,
  getPendingAttempt,
  listPendingAttempts,
  savePendingAttempt,
} from './pendingPaymentAttempt';
import type { PendingPaymentAttempt } from './pendingPaymentAttempt';

/* ------------------------------------------------------------------------------------------------
 * Paiement d'une consultation sous le verrou serveur `consultation_payment_lock` (guide, étape 3) :
 *   consultation `pending_payment` → register-payment-attempt → widget MultiPay → confirm-consultation-payment.
 * Le client n'écrit JAMAIS payment_status / payment_amount / currency / payment_reference /
 * fee_percent_at_booking, ni `status = 'scheduled'` : seule `confirm-consultation-payment` (service_role)
 * le fait. `supabase.functions.invoke` envoie `Authorization: Bearer <session>` + `apikey`.
 * Les paiements prestataire (abonnement / avoir) sont plus bas (`registerProviderPaymentAttempt`).
 * ---------------------------------------------------------------------------------------------- */

/**
 * Contrat du widget de paiement (injecté : voir `src/services/paymentWidget.ts`). Seul `cancelled` est
 * DÉFINITIF et efface la tentative mémorisée ; toute autre issue sans `success` la conserve.
 * - `success` : débité, `payRef` fourni → `confirm-consultation-payment`.
 * - `paid_unconfirmed` : débité (`resp 00`) mais sans `payRef`.
 * - `cancelled` : la passerelle a EXPLICITEMENT rapporté une annulation / un refus (X1, Z6…).
 * - `dismissed` : aucune issue définitive (écran quitté, retour passerelle sans résultat, timeout `TO` qui peut
 *   encore aboutir) → la tentative est conservée, on ne prétend pas « paiement non effectué ».
 */
export type PaymentWidgetResult =
  | { status: 'success'; payRef: string }
  | { status: 'paid_unconfirmed' }
  | { status: 'cancelled' }
  | { status: 'dismissed'; reason: 'user_left' | 'gateway_returned' | 'timeout' };

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
 * Appel commun d'un `register-*-payment-attempt` (consultation ou prestataire), même politique :
 * - 200 `{ success: true }` (ou 200 `{ alreadyPaid: true }`) → renvoie le corps.
 * - `NOT_PAYABLE` / `TXN_ALREADY_USED` (corps 200 `success:false` ou HTTP 409) → `PaymentNotPayableError`.
 * - Erreur réseau, 429, 5xx (dont 503) → ne bloque PAS le paiement : renvoie `null` (rattrapage serveur absent).
 * - 401 (jeton expiré) → rafraîchit la session UNE fois et rejoue UNE fois ; refresh en échec = session
 *   expirée (signalée via `reportSessionExpiry`), on bloque.
 * - 400 / 403 / 404 → `PaymentRegistrationError` : on BLOQUE.
 *
 * Écart volontaire avec le guide (qui ne cite que NOT_PAYABLE / TXN_ALREADY_USED comme bloquants) : un
 * enregistrement définitivement refusé est condamné, la confirmation échouerait de la même façon APRÈS que
 * l'utilisateur a payé. Mieux vaut ne pas ouvrir le widget que débiter sans pouvoir confirmer.
 */
async function registerAttempt(functionName: string, body: Record<string, unknown>): Promise<any | null> {
  const call = async (): Promise<InvokeResult | null> => {
    try {
      return await supabase!.functions.invoke(functionName, { body });
    } catch {
      return null; // hors ligne : le paiement continue
    }
  };

  let result = await call();
  if (!result) return null;
  let refreshed = false;
  for (;;) {
    const { data, error } = result;
    if (error) {
      const { status, body: errBody } = await readHttpError(error);
      if (isNotPayableCode(errBody?.code)) throw new PaymentNotPayableError(errBody.code);
      if (status === 401) {
        if (refreshed) throw new PaymentRegistrationError(401, edgeFunctionError(errBody, error?.message).message);
        refreshed = true;
        if (!(await refreshSessionOnce())) throw sessionExpiredError();
        const retry = await call();
        if (!retry) return null;
        result = retry;
        continue;
      }
      if (status === undefined || status === 429 || status >= 500) return null;
      throw new PaymentRegistrationError(status, edgeFunctionError(errBody, error?.message).message);
    }
    if (data?.success === false) {
      if (isNotPayableCode(data.code)) throw new PaymentNotPayableError(data.code);
      throw new PaymentRegistrationError(undefined, edgeFunctionError(data).message);
    }
    return data ?? {};
  }
}

/** `POST /functions/v1/register-payment-attempt` `{ consultationId, txnRef, useWallet }` (voir `registerAttempt`). */
export async function registerConsultationPayment(
  consultationId: string,
  txnRef: string,
  useWallet = false,
): Promise<void> {
  await registerAttempt('register-payment-attempt', { consultationId, txnRef, useWallet });
}

/* ------------------------------------------------------------------------------------------------
 * Paiements PRESTATAIRE (guide MOB-0712-1) : abonnement et recharge d'avoir.
 * Ordre imposé pour un futur écran : `generateTxnRef()` → `registerProviderPaymentAttempt` (ou
 * `registerProviderPaymentWithRetry`) → widget avec cette `txnRef` → au succès `confirm-subscription-payment`
 * ou `confirm-wallet-recharge` avec la MÊME `txnRef`. Le client n'envoie JAMAIS de montant (calculé par le
 * serveur) et n'écrit JAMAIS dans `provider_subscriptions` / `call_transactions` (verrous `enforce`, 42501).
 * ---------------------------------------------------------------------------------------------- */

export const WALLET_RECHARGE_QUANTITIES = [5, 10, 20, 50, 100] as const;
export type WalletRechargeQuantity = (typeof WALLET_RECHARGE_QUANTITIES)[number];

export type ProviderPaymentAttemptBody =
  | { kind: 'subscription'; subscriptionId: string; txnRef: string }
  | { kind: 'wallet_recharge'; quantity: WalletRechargeQuantity; currency: string; txnRef: string };

/** Corps sans `txnRef` : `registerProviderPaymentWithRetry` génère (et au besoin régénère) la référence. */
export type ProviderPaymentRequest =
  | { kind: 'subscription'; subscriptionId: string }
  | { kind: 'wallet_recharge'; quantity: WalletRechargeQuantity; currency: string };

/**
 * - `registered` : le serveur a enregistré la référence (200 `success`).
 * - `already_paid` : 200 `alreadyPaid` — l'appelant NE DOIT PAS ouvrir le widget, il relit l'abonnement.
 * - `not_registered` : réseau / 429 / 503 / 5xx — le paiement peut continuer, sans rattrapage serveur.
 * - `simulated` : simulation locale (développement uniquement) — rien n'a été appelé.
 */
export type ProviderPaymentRegistration = {
  status: 'registered' | 'already_paid' | 'not_registered' | 'simulated';
};

/** Simulation locale : JAMAIS en build de production (`EXPO_PUBLIC_APP_ENV` doit valoir `development`). */
const isProviderPaymentSimulated = (): boolean =>
  process.env.EXPO_PUBLIC_APP_ENV === 'development' && process.env.EXPO_PUBLIC_SIMULATE_PROVIDER_PAYMENT === 'true';

/**
 * `POST /functions/v1/register-provider-payment-attempt`. Le corps envoyé est reconstruit champ par champ :
 * aucun `amount` (ni autre champ parasite) ne part, même si l'appelant en passe un via un cast.
 * Politique d'erreurs : voir `registerAttempt`. `TXN_ALREADY_USED` est levé tel quel (une régénération de
 * `txnRef` est faite par `registerProviderPaymentWithRetry`). `403` = recharge par un non-prestataire,
 * `404` = abonnement d'un autre, `400` = requête invalide : tous bloquent.
 */
export async function registerProviderPaymentAttempt(
  body: ProviderPaymentAttemptBody,
): Promise<ProviderPaymentRegistration> {
  let wire: Record<string, unknown>;
  if (body.kind === 'subscription') {
    wire = { kind: 'subscription', subscriptionId: body.subscriptionId, txnRef: body.txnRef };
  } else if (body.kind === 'wallet_recharge') {
    if (!(WALLET_RECHARGE_QUANTITIES as readonly unknown[]).includes(body.quantity)) {
      throw new PaymentRegistrationError(
        undefined,
        translate('Quantité de recharge invalide (5, 10, 20, 50 ou 100).'),
      );
    }
    wire = { kind: 'wallet_recharge', quantity: body.quantity, currency: body.currency, txnRef: body.txnRef };
  } else {
    throw new PaymentRegistrationError(undefined, translate('Type de paiement inconnu.'));
  }
  if (isProviderPaymentSimulated()) return { status: 'simulated' };

  const data = await registerAttempt('register-provider-payment-attempt', wire);
  if (data === null) return { status: 'not_registered' };
  if (data.alreadyPaid === true) return { status: 'already_paid' };
  return { status: 'registered' };
}

/**
 * Génère une `txnRef`, l'enregistre ; sur `409 TXN_ALREADY_USED` génère UNE nouvelle `txnRef` et réessaie
 * UNE fois (un second `TXN_ALREADY_USED` est levé). Renvoie la `txnRef` à donner au widget ET à la confirmation.
 */
export async function registerProviderPaymentWithRetry(
  request: ProviderPaymentRequest,
): Promise<ProviderPaymentRegistration & { txnRef: string }> {
  let txnRef = generateTxnRef();
  try {
    return { ...(await registerProviderPaymentAttempt({ ...request, txnRef })), txnRef };
  } catch (e) {
    if (!(e instanceof PaymentNotPayableError && e.code === 'TXN_ALREADY_USED')) throw e;
    txnRef = generateTxnRef();
    return { ...(await registerProviderPaymentAttempt({ ...request, txnRef })), txnRef };
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
/** Confirmée côté serveur : `paid`, ou déjà au-delà du paiement (`scheduled` / `in_progress` / `completed`). */
const CONFIRMED_STATUSES = ['scheduled', 'in_progress', 'completed'];
const isPaid = (row: ConsultationPaymentState) =>
  row.paymentStatus === 'paid' || CONFIRMED_STATUSES.includes(row.status);

/** Utilisateur connecté (session locale) ; `null` sans session ou si la session est illisible. */
export async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase!.auth.getSession();
    return data?.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Échec « fermé » : sans utilisateur authentifié on ne paie JAMAIS (une tentative non persistée = débit non
 * rattrapable). Lève AVANT l'enregistrement et l'ouverture du widget.
 */
async function requireUserId(): Promise<string> {
  const userId = await currentUserId();
  if (!userId) throw sessionExpiredError();
  return userId;
}

/* ---------- Stockage « au mieux » : un disque plein ne doit jamais bloquer ni confirmer un paiement ---------- */

const safeSave = async (userId: string, a: { consultationId: string; txnRef: string; payRef?: string }) => {
  await savePendingAttempt({ userId, ...a }).catch(() => undefined);
};
const safeClear = async (userId: string, consultationId: string) => {
  await clearPendingAttempt(consultationId, userId).catch(() => undefined);
};

/* ---------- Garde « en cours » par consultation (reconcile / pay / payExisting jamais en parallèle) ---------- */

const inFlight = new Set<string>();

/** Exécute `fn` si aucune opération n'est en cours pour cette consultation ; sinon renvoie `busy`. */
async function guarded<T, B>(consultationId: string, busy: () => B, fn: () => Promise<T>): Promise<T | B> {
  if (inFlight.has(consultationId)) return busy();
  inFlight.add(consultationId);
  try {
    return await fn();
  } finally {
    inFlight.delete(consultationId);
  }
}

/** Une autre opération de paiement est déjà en cours pour cette consultation. */
export class PaymentInProgressError extends Error {
  consultationId?: string;
  constructor() {
    super(translate('Paiement en cours de vérification, ne repaie pas. Réessaie dans quelques minutes.'));
    this.name = 'PaymentInProgressError';
  }
}

const supportError = (consultationId: string, txnRef: string) =>
  withContext(
    new PaymentConfirmationError(
      translate(
        "Ton paiement a été reçu mais ta consultation n'est pas encore confirmée. Ne paie pas une seconde fois : contacte le support si cela dure.",
      ),
    ),
    consultationId,
    txnRef,
  );

/** Paiement reçu (payRef) mais la consultation n'est ni payée ni payable : contacter le support avec la référence. */
const paidButUnconfirmedError = (consultationId: string, txnRef: string) =>
  withContext(
    new PaymentConfirmationError(
      `${translate('Paiement reçu mais consultation non confirmée : contacte le support avec la référence')} ${txnRef}`,
    ),
    consultationId,
    txnRef,
  );

/**
 * Rejoue `confirm` avec la MÊME `txnRef` / `payRef` mémorisées. `handled` = le serveur répond NOT_PAYABLE
 * (déjà traité) : la tentative n'est PAS effacée ici, l'appelant relit la ligne et ne l'efface que si elle est `paid`.
 */
async function confirmStoredAttempt(a: PendingPaymentAttempt, useWallet: boolean): Promise<'paid' | 'handled'> {
  try {
    await confirmConsultationPayment(a.consultationId, a.txnRef, a.payRef!, useWallet);
  } catch (e) {
    if (e instanceof PaymentNotPayableError) return 'handled';
    throw e;
  }
  const row = await readSafe(a.consultationId);
  if (row && isPaid(row)) {
    await safeClear(a.userId, a.consultationId);
    return 'paid';
  }
  // Confirmé mais la base ne l'affiche pas (encore) : on garde la tentative pour la prochaine reprise.
  throw withContext(new PaymentConfirmationError(), a.consultationId, a.txnRef);
}

/** Après `handled` : payée → on oublie la tentative ; sinon cas support (rien n'est rouvert, la tentative reste). */
async function settleHandled(a: PendingPaymentAttempt): Promise<void> {
  const row = await readSafe(a.consultationId);
  if (row && isPaid(row)) {
    await safeClear(a.userId, a.consultationId);
    return;
  }
  throw supportError(a.consultationId, a.txnRef);
}

export type PayConsultationResult =
  | { status: 'confirmed'; txnRef: string }
  | { status: 'cancelled'; txnRef: string }
  /** Issue inconnue : la tentative est conservée (voir `PaymentWidgetResult`). */
  | { status: 'dismissed'; txnRef: string; reason: 'user_left' | 'gateway_returned' | 'timeout' };

async function payConsultationUnlocked(
  userId: string,
  input: {
  consultationId: string;
  openPaymentWidget: OpenPaymentWidget;
  useWallet?: boolean;
},
): Promise<PayConsultationResult> {
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
  await safeSave(userId, { consultationId, txnRef });
  let outcome: PaymentWidgetResult;
  try {
    outcome = await openPaymentWidget(txnRef);
  } catch (e) {
    await safeClear(userId, consultationId); // le widget n'a pas pu démarrer : rien n'a été débité
    throw e;
  }
  if (outcome.status === 'cancelled') {
    await safeClear(userId, consultationId); // annulation / refus EXPLICITE de la passerelle
    return { status: 'cancelled', txnRef };
  }
  if (outcome.status === 'dismissed') {
    return { status: 'dismissed', txnRef, reason: outcome.reason }; // tentative conservée
  }
  if (outcome.status === 'paid_unconfirmed') {
    throw withContext(
      new PaymentConfirmationError(translate('Paiement effectué, ne repaie pas. Nous vérifions ta transaction.')),
      consultationId,
      txnRef,
    );
  }

  // Avant confirm, jamais bloquant : même si l'écriture échoue, confirm est TOUJOURS appelé.
  const stored: PendingPaymentAttempt = { userId, consultationId, txnRef, payRef: outcome.payRef, at: Date.now() };
  await safeSave(userId, stored);
  const result = await confirmStoredAttempt(stored, useWallet);
  if (result === 'handled') await settleHandled(stored);
  return { status: 'confirmed', txnRef };
}

/**
 * Ordre imposé : nouvelle `txnRef` → `register-payment-attempt` (une seule régénération si `TXN_ALREADY_USED`,
 * jamais pour `NOT_PAYABLE`) → tentative mémorisée (sans `payRef`) → widget → (succès) tentative mémorisée avec
 * `payRef` PUIS `confirm-consultation-payment` → relecture en base ; la tentative n'est effacée qu'une fois la
 * ligne `paid`. Annulation EXPLICITE : tentative effacée, la consultation reste `pending_payment`. Écran quitté /
 * retour passerelle / timeout : tentative conservée. Débité sans `payRef` : tentative conservée, « ne repaie pas ».
 * Une opération déjà en cours pour cette consultation → `PaymentInProgressError`.
 */
export async function payConsultation(input: {
  consultationId: string;
  openPaymentWidget: OpenPaymentWidget;
  useWallet?: boolean;
}): Promise<PayConsultationResult> {
  return guarded(
    input.consultationId,
    () => {
      throw new PaymentInProgressError();
    },
    async () => payConsultationUnlocked(await requireUserId(), input),
  );
}

export type PayExistingResult =
  | PayConsultationResult
  | { status: 'already_paid' }
  /** Tentative incertaine (sans `payRef`) : ne pas rouvrir de widget. `canOverride` : plus de 15 min, reprise explicite possible. */
  | { status: 'verifying'; canOverride: boolean };

/**
 * « Tu as été débité ? » après un `dismissed` : « Non » → la tentative est effacée (on peut repayer) ;
 * « Oui » → conservée (message de vérification, reprise explicite possible après 15 min).
 */
export async function resolveDismissedAttempt(consultationId: string, debited: boolean): Promise<void> {
  const userId = await currentUserId();
  if (!debited && userId) await safeClear(userId, consultationId);
}

async function payExistingUnlocked(input: {
  consultationId: string;
  openPaymentWidget: OpenPaymentWidget;
  useWallet?: boolean;
  override?: boolean;
}): Promise<PayExistingResult> {
  const { consultationId, openPaymentWidget, useWallet = false, override = false } = input;
  const userId = await requireUserId();
  const row = await readConsultationPayment(consultationId);
  const attempt = await getPendingAttempt(consultationId, userId);
  if (row && isPaid(row)) {
    await safeClear(userId, consultationId);
    return { status: 'already_paid' };
  }
  // Le patient a payé (payRef) mais la ligne n'est ni payable ni confirmée (expirée, annulée, invisible) :
  // on ne rouvre rien et on ne purge rien, cas support avec la référence.
  if (attempt?.payRef && (!row || row.status !== 'pending_payment')) {
    throw paidButUnconfirmedError(consultationId, attempt.txnRef);
  }
  if (!row) throw new PaymentNotPayableError('NOT_PAYABLE');
  if (row.status !== 'pending_payment') throw new PaymentNotPayableError('NOT_PAYABLE');

  if (attempt?.payRef) {
    const outcome = await confirmStoredAttempt(attempt, useWallet);
    if (outcome === 'handled') await settleHandled(attempt); // payée, ou cas support : jamais de nouveau widget
    return { status: 'confirmed', txnRef: attempt.txnRef };
  }
  if (attempt) {
    const canOverride = Date.now() - attempt.at >= PAYMENT_ATTEMPT_STALE_MS;
    if (!(override && canOverride)) return { status: 'verifying', canOverride };
    await safeClear(userId, consultationId);
  }
  return payConsultationUnlocked(userId, { consultationId, openPaymentWidget, useWallet });
}

/**
 * Repaie une consultation déjà créée. Relit d'abord la ligne (déjà payée → refus ; plus `pending_payment` →
 * NOT_PAYABLE), rejoue `confirm` si une tentative AVEC `payRef` est mémorisée (même `txnRef` / `payRef` ; si le
 * serveur répond « déjà traité » mais que la ligne reste impayée : erreur support, jamais de nouveau widget), ne
 * rouvre PAS de widget si une tentative SANS `payRef` est mémorisée (sauf `override` explicite après 15 min),
 * sinon nouvelle `txnRef`. Une opération déjà en cours → `{ status: 'verifying' }`.
 */
export async function payExistingConsultation(input: {
  consultationId: string;
  openPaymentWidget: OpenPaymentWidget;
  useWallet?: boolean;
  override?: boolean;
}): Promise<PayExistingResult> {
  return guarded(
    input.consultationId,
    (): PayExistingResult => ({ status: 'verifying', canOverride: false }),
    () => payExistingUnlocked(input),
  );
}

/** Paiement reçu (payRef) pour une consultation ni payée ni payable : à traiter par le support. */
export interface PaymentSupportCase {
  consultationId: string;
  txnRef: string;
}

/**
 * Au retour sur « Mes consultations » : pour chaque tentative de l'utilisateur courant, relit la ligne ; payée /
 * programmée → on oublie la tentative ; `pending_payment` avec `payRef` → on rejoue `confirm` (même `txnRef` /
 * `payRef`) ; autre statut (expirée, annulée, invisible) avec `payRef` → la tentative est CONSERVÉE et renvoyée
 * comme cas support. Une tentative sans `payRef` n'est jamais confirmée ici ; une consultation déjà traitée par une
 * autre opération est ignorée. Ne lève jamais.
 */
export async function reconcilePendingPayments(): Promise<PaymentSupportCase[]> {
  const cases: PaymentSupportCase[] = [];
  const userId = await currentUserId();
  if (!userId) return cases;
  let attempts: PendingPaymentAttempt[];
  try {
    attempts = await listPendingAttempts(userId);
  } catch {
    return cases;
  }
  for (const attempt of attempts) {
    await guarded(
      attempt.consultationId,
      () => undefined,
      async () => {
        try {
          const row = await readConsultationPayment(attempt.consultationId);
          if (row && isPaid(row)) await safeClear(userId, attempt.consultationId);
          else if (attempt.payRef && row?.status === 'pending_payment') {
            if ((await confirmStoredAttempt(attempt, false)) === 'handled') await settleHandled(attempt);
          } else if (attempt.payRef) {
            cases.push({ consultationId: attempt.consultationId, txnRef: attempt.txnRef });
          }
        } catch {
          /* réessayé au prochain retour sur l'écran */
        }
      },
    );
  }
  return cases;
}
