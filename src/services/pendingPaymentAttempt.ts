import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Tentative de paiement de consultation en cours, persistée pour survivre à un arrêt de l'app :
 * `{ consultationId, txnRef, payRef?, at }`. Sans `payRef` = widget ouvert, issue inconnue (incertain) ;
 * avec `payRef` = le widget a confirmé le paiement, `confirm-consultation-payment` reste à acquitter.
 * Données non secrètes (références de transaction) : AsyncStorage est autorisé.
 */
export const PENDING_PAYMENT_KEY = 'visiodoc.pendingConsultationPayments.v1';

export interface PendingPaymentAttempt {
  consultationId: string;
  txnRef: string;
  payRef?: string;
  /** Millisecondes (`Date.now()`) du début de la tentative. */
  at: number;
}

type Store = Record<string, PendingPaymentAttempt>;

async function readStore(): Promise<Store> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_PAYMENT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

const writeStore = (store: Store) => AsyncStorage.setItem(PENDING_PAYMENT_KEY, JSON.stringify(store));

/** Enregistre (ou complète avec `payRef`) la tentative. Même `txnRef` → l'horodatage de départ est conservé. */
export async function savePendingAttempt(input: {
  consultationId: string;
  txnRef: string;
  payRef?: string;
}): Promise<void> {
  const store = await readStore();
  const previous = store[input.consultationId];
  const at = previous && previous.txnRef === input.txnRef ? previous.at : Date.now();
  const next: PendingPaymentAttempt = { consultationId: input.consultationId, txnRef: input.txnRef, at };
  if (input.payRef) next.payRef = input.payRef;
  store[input.consultationId] = next;
  await writeStore(store);
}

export async function getPendingAttempt(consultationId: string): Promise<PendingPaymentAttempt | null> {
  return (await readStore())[consultationId] ?? null;
}

/** Au-delà de 24 h une tentative n'a plus de sens (le serveur a depuis longtemps libéré / rattrapé le paiement). */
export const PENDING_ATTEMPT_MAX_AGE_MS = 24 * 3600_000;

/** Liste les tentatives ; celles de plus de 24 h sont PURGÉES du stockage. */
export async function listPendingAttempts(): Promise<PendingPaymentAttempt[]> {
  const store = await readStore();
  const now = Date.now();
  const fresh: Store = {};
  for (const [id, attempt] of Object.entries(store)) {
    if (typeof attempt?.at === 'number' && now - attempt.at <= PENDING_ATTEMPT_MAX_AGE_MS) fresh[id] = attempt;
  }
  if (Object.keys(fresh).length !== Object.keys(store).length) {
    try {
      await writeStore(fresh);
    } catch {
      /* purge réessayée au prochain listing */
    }
  }
  return Object.values(fresh);
}

/** Déconnexion : plus aucune tentative mémorisée (elles appartiennent au compte qui se déconnecte). */
export async function clearAllPendingAttempts(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_PAYMENT_KEY);
}

export async function clearPendingAttempt(consultationId: string): Promise<void> {
  const store = await readStore();
  if (!(consultationId in store)) return;
  delete store[consultationId];
  await writeStore(store);
}
