import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Tentative de paiement de consultation en cours, persistée pour survivre à un arrêt de l'app :
 * `{ userId, consultationId, txnRef, payRef?, at }`. Sans `payRef` = widget ouvert, issue inconnue (incertain) ;
 * avec `payRef` = le widget a confirmé le paiement, `confirm-consultation-payment` reste à acquitter.
 * Données non secrètes (références de transaction) : AsyncStorage est autorisé.
 *
 * Chaque tentative appartient à un utilisateur (`userId`) : lecture / liste / effacement sont filtrés par
 * l'utilisateur courant, donc RIEN n'est effacé à la déconnexion (expiration de session, refus de rôle…) :
 * l'utilisateur A retrouve ses tentatives après reconnexion et l'utilisateur B ne les voit jamais.
 */
export const PENDING_PAYMENT_KEY = 'visiodoc.pendingConsultationPayments.v1';

export interface PendingPaymentAttempt {
  userId: string;
  consultationId: string;
  txnRef: string;
  payRef?: string;
  /** Millisecondes (`Date.now()`) du début de la tentative. */
  at: number;
}

type Store = Record<string, PendingPaymentAttempt>;

/**
 * Toutes les opérations sur le stockage (lecture-modification-écriture) passent par UNE file : deux
 * mutations concurrentes ne peuvent pas se perdre mutuellement. Une opération rejetée n'empoisonne pas la file.
 */
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(op: () => Promise<T>): Promise<T> {
  const run = queue.then(op);
  queue = run.catch(() => undefined);
  return run;
}

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

const owned = (a: PendingPaymentAttempt | undefined, userId: string): a is PendingPaymentAttempt =>
  !!a && typeof a === 'object' && !!userId && a.userId === userId;

/** Enregistre (ou complète avec `payRef`) la tentative. Même `txnRef` → l'horodatage de départ est conservé. */
export function savePendingAttempt(input: {
  userId: string;
  consultationId: string;
  txnRef: string;
  payRef?: string;
}): Promise<void> {
  return serialize(async () => {
    const store = await readStore();
    const previous = store[input.consultationId];
    const same = owned(previous, input.userId) && previous.txnRef === input.txnRef;
    const at = same ? previous.at : Date.now();
    const next: PendingPaymentAttempt = {
      userId: input.userId,
      consultationId: input.consultationId,
      txnRef: input.txnRef,
      at,
    };
    if (input.payRef) next.payRef = input.payRef;
    store[input.consultationId] = next;
    await writeStore(store);
  });
}

export function getPendingAttempt(consultationId: string, userId: string): Promise<PendingPaymentAttempt | null> {
  return serialize(async () => {
    const attempt = (await readStore())[consultationId];
    return owned(attempt, userId) ? attempt : null;
  });
}

/** Au-delà de 24 h une tentative SANS `payRef` n'a plus de sens (le créneau serveur est libéré depuis longtemps). */
export const PENDING_ATTEMPT_MAX_AGE_MS = 24 * 3600_000;

/**
 * Purge les tentatives sans `payRef` de plus de 24 h. Une tentative qui porte un `payRef` n'est JAMAIS purgée par
 * l'âge (le patient a été débité) : elle ne disparaît que quand la ligne est relue `paid` / `scheduled`.
 */
async function purgeStale(store: Store): Promise<Store> {
  const now = Date.now();
  const kept: Store = {};
  for (const [id, a] of Object.entries(store)) {
    if (!a || typeof a !== 'object') continue;
    const stale = !a.payRef && !(typeof a.at === 'number' && now - a.at <= PENDING_ATTEMPT_MAX_AGE_MS);
    if (!stale) kept[id] = a;
  }
  if (Object.keys(kept).length !== Object.keys(store).length) {
    try {
      await writeStore(kept);
    } catch {
      /* purge réessayée au prochain passage */
    }
  }
  return kept;
}

export function purgeStalePendingAttempts(): Promise<void> {
  return serialize(async () => {
    await purgeStale(await readStore());
  });
}

/** Liste les tentatives de CET utilisateur (après purge des tentatives sans `payRef` de plus de 24 h). */
export function listPendingAttempts(userId: string): Promise<PendingPaymentAttempt[]> {
  return serialize(async () => {
    const kept = await purgeStale(await readStore());
    return Object.values(kept).filter((a) => owned(a, userId));
  });
}

/** Efface la tentative de cet utilisateur pour cette consultation (jamais celle d'un autre compte). */
export function clearPendingAttempt(consultationId: string, userId: string): Promise<void> {
  return serialize(async () => {
    const store = await readStore();
    if (!owned(store[consultationId], userId)) return;
    delete store[consultationId];
    await writeStore(store);
  });
}
