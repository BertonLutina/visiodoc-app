import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Limites de session (guide MOB-0612-2) : inactivité 1 h, durée maximale 12 h depuis la connexion.
 * (Le jeton de 30 min est rafraîchi par le SDK : voir `sessionExpiry.ts`.)
 * Les horodatages sont persistés : une app fermée plus d'1 h, ou ouverte plus de 12 h après la connexion, ne
 * restaure pas la session. Une panne de stockage ne bloque jamais l'utilisateur (on laisse la session vivre).
 */
export const INACTIVITY_LIMIT_MS = 60 * 60 * 1000;
export const MAX_SESSION_MS = 12 * 60 * 60 * 1000;
/** Écriture disque des interactions au plus toutes les 30 s (le suivi en mémoire est, lui, immédiat). */
export const PERSIST_EVERY_MS = 30_000;

export type SessionClock = { signedInAt: number; lastActivityAt: number };
export type SessionLimit = 'inactivity' | 'max_duration';

/** Limite atteinte à l'instant `now`, ou null. La durée maximale est testée en premier. */
export function sessionLimitReached(clock: SessionClock, now: number): SessionLimit | null {
  if (now - clock.signedInAt >= MAX_SESSION_MS) return 'max_duration';
  if (now - clock.lastActivityAt >= INACTIVITY_LIMIT_MS) return 'inactivity';
  return null;
}

type KeyValueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
};

const KEY = 'visiodoc.sessionClock.v1';

const isClock = (v: unknown): v is SessionClock =>
  !!v &&
  typeof v === 'object' &&
  Number.isFinite((v as SessionClock).signedInAt) &&
  Number.isFinite((v as SessionClock).lastActivityAt);

export function createSessionClock(storage: KeyValueStorage, nowFn: () => number = Date.now) {
  let clock: SessionClock | null = null;
  let lastPersist = 0;

  const save = async () => {
    if (!clock) return;
    try {
      await storage.setItem(KEY, JSON.stringify(clock));
    } catch {
      /* stockage indisponible : le suivi en mémoire continue */
    }
  };

  return {
    /** Nouvelle connexion : les deux horodatages repartent de maintenant. */
    async start(): Promise<void> {
      const now = nowFn();
      clock = { signedInAt: now, lastActivityAt: now };
      lastPersist = now;
      await save();
    },

    /** Session restaurée au démarrage : relit l'horloge persistée ; absente ou illisible = on repart de maintenant. */
    async restore(): Promise<void> {
      try {
        const raw = await storage.getItem(KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (isClock(parsed)) {
          clock = parsed;
          lastPersist = nowFn();
          return;
        }
      } catch {
        /* illisible : traité comme absent */
      }
      await this.start();
    },

    /** Interaction de l'utilisateur (toucher). Sans effet hors session. */
    touch(): void {
      if (!clock) return;
      const now = nowFn();
      clock.lastActivityAt = now;
      if (now - lastPersist >= PERSIST_EVERY_MS) {
        lastPersist = now;
        void save();
      }
    },

    /** Limite atteinte maintenant ? Null s'il n'y a pas de session suivie. */
    check(): SessionLimit | null {
      return clock ? sessionLimitReached(clock, nowFn()) : null;
    },

    /** Déconnexion ou expiration : efface le suivi. */
    async clear(): Promise<void> {
      clock = null;
      try {
        await storage.removeItem(KEY);
      } catch {
        /* ignore */
      }
    },
  };
}

/** Horloge de l'application (une seule session à la fois). */
export const sessionClock = createSessionClock(AsyncStorage);

/** À appeler à chaque toucher (racine de l'app). */
export const noteUserActivity = (): void => sessionClock.touch();
