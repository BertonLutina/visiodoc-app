import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/**
 * Stockage de la session Supabase (jetons) dans le trousseau (iOS Keychain / Android Keystore) via
 * `expo-secure-store`, pour le client d'authentification principal uniquement.
 *
 * - Une valeur SecureStore est limitée à ~2048 octets alors qu'une session Supabase (JWT + utilisateur)
 *   peut la dépasser : la valeur est découpée en fragments (≤ 1800 octets UTF-8, jamais au milieu d'un caractère).
 * - Écriture par GÉNÉRATION : chaque `setItem` écrit ses fragments sous une génération neuve
 *   (`${base}.g${nonce}.__${i}`), puis écrit l'enregistrement `${base}.__n` = `v2:nonce:nombre:longueur`.
 *   Cette dernière écriture est le seul « interrupteur » : tant qu'elle n'a pas réussi, la lecture suit
 *   l'ancienne génération, intacte. Une panne à n'importe quel appel laisse donc l'ancienne valeur (ou
 *   `null`), jamais un mélange d'anciens et de nouveaux fragments (qui, avec la rotation des jetons de
 *   rafraîchissement, pourrait déclencher la détection de réutilisation et révoquer la session).
 * - Journal `${base}.__j` = `nonce:nombre,…` : liste des générations susceptibles d'exister, écrit AVANT
 *   les fragments. Il permet à `removeItem` (et au nettoyage du `setItem` suivant) de retrouver des
 *   fragments orphelins, même si l'enregistrement est absent ou si une suppression précédente a échoué.
 * - Les clés SecureStore n'acceptent que [A-Za-z0-9._-] : les autres caractères sont ÉCHAPPÉS (`_hex_`), pas
 *   écrasés, donc `a:b` et `a_b` restent distincts.
 * - Migration : les utilisateurs déjà connectés ont leur session dans AsyncStorage (même clé). Au premier
 *   `getItem` sans valeur lisible dans le trousseau, elle y est copiée puis supprimée d'AsyncStorage.
 * - Web : SecureStore n'existe pas → AsyncStorage.
 * - Aucun mot de passe n'est jamais écrit ici : le SDK ne persiste que la session (jetons + profil).
 */

/** Octets UTF-8 maximum par fragment (marge sous la limite de 2048 octets). */
const CHUNK_BYTES = 1800;

/** `AFTER_FIRST_UNLOCK` : lisible en arrière-plan / appareil verrouillé après un premier déverrouillage,
 *  sinon un rafraîchissement automatique appareil verrouillé échouerait et déconnecterait l'utilisateur. */
const writeOptions = () => ({ keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });

const ALLOWED = /[A-Za-z0-9.-]/;
/** Échappement injectif : tout caractère hors [A-Za-z0-9.-] (y compris `_`) devient `_<hex>_`. */
const escapeKey = (key: string): string =>
  Array.from(key)
    .map((c) => (ALLOWED.test(c) ? c : `_${(c.codePointAt(0) as number).toString(16)}_`))
    .join('');

const metaKey = (key: string): string => `${escapeKey(key)}.__n`;
const journalKey = (key: string): string => `${escapeKey(key)}.__j`;
const chunkKey = (key: string, nonce: string, index: number): string => `${escapeKey(key)}.g${nonce}.__${index}`;

/** Générations périmées suivies au maximum dans le journal (une valeur SecureStore ne dépasse pas ~2048 octets). */
const MAX_STALE_GENERATIONS = 10;

const newNonce = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const useKeychain = (): boolean => Platform.OS !== 'web';

/** Découpe sans jamais couper un caractère (ni une paire de substitution) et sans dépasser `maxBytes` UTF-8. */
function splitByBytes(value: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) as number;
    const size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (bytes + size > maxBytes) {
      chunks.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  chunks.push(current);
  return chunks;
}

interface Generation {
  nonce: string;
  count: number;
}

/** Enregistrement actif : `null` si absent, illisible ou d'un ancien format (traité comme absent). */
async function readMeta(key: string): Promise<(Generation & { length: number }) | null> {
  const raw = await SecureStore.getItemAsync(metaKey(key));
  if (raw === null) return null;
  const match = /^v2:([A-Za-z0-9]+):(\d+):(\d+)$/.exec(raw);
  if (!match) return null;
  return { nonce: match[1], count: Number(match[2]), length: Number(match[3]) };
}

async function readJournal(key: string): Promise<Generation[]> {
  try {
    const raw = await SecureStore.getItemAsync(journalKey(key));
    if (!raw) return [];
    return raw
      .split(',')
      .map((entry) => /^([A-Za-z0-9]+):(\d+)$/.exec(entry))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ nonce: m[1], count: Number(m[2]) }));
  } catch {
    return [];
  }
}

const serializeJournal = (gens: Generation[]): string => gens.map((g) => `${g.nonce}:${g.count}`).join(',');

/** Supprime les fragments d'une génération ; renvoie la première erreur (sans s'arrêter) ou `null`. */
async function deleteGeneration(key: string, gen: Generation): Promise<unknown> {
  let firstError: unknown = null;
  for (let i = 0; i < gen.count; i += 1) {
    try {
      await SecureStore.deleteItemAsync(chunkKey(key, gen.nonce, i));
    } catch (e) {
      firstError ??= e;
    }
  }
  return firstError;
}

/**
 * Borne le journal : conserve les `MAX_STALE_GENERATIONS` générations périmées les plus récentes ; pour les plus
 * anciennes (écartées), une dernière tentative de suppression au mieux avant de les oublier.
 * La génération VIVANTE (`liveNonce`, celle que pointe l'enregistrement actif) n'est jamais candidate : après
 * des écritures en échec consécutives elle serait sinon la plus ancienne et ses fragments seraient supprimés.
 */
async function pruneStale(key: string, stale: Generation[], liveNonce?: string): Promise<Generation[]> {
  const live = stale.filter((g) => g.nonce === liveNonce);
  const candidates = stale.filter((g) => g.nonce !== liveNonce);
  if (candidates.length <= MAX_STALE_GENERATIONS) return stale;
  const dropped = candidates.slice(0, candidates.length - MAX_STALE_GENERATIONS);
  for (const gen of dropped) await deleteGeneration(key, gen);
  return [...live, ...candidates.slice(-MAX_STALE_GENERATIONS)];
}

async function writeKeychain(key: string, value: string): Promise<void> {
  const chunks = splitByBytes(value, CHUNK_BYTES);
  const nonce = newNonce();
  const previousMeta = await readMeta(key).catch(() => null);
  const previous = await readJournal(key);
  if (previousMeta && !previous.some((g) => g.nonce === previousMeta.nonce)) previous.push(previousMeta);
  const tracked = await pruneStale(key, previous, previousMeta?.nonce);

  // 1. Journal (ancien + nouveau) AVANT les fragments : aucun fragment n'est jamais introuvable pour un nettoyage.
  await SecureStore.setItemAsync(journalKey(key), serializeJournal([...tracked, { nonce, count: chunks.length }]), writeOptions());
  // 2. Fragments de la nouvelle génération (invisibles pour les lecteurs tant que l'enregistrement ne pointe pas dessus).
  for (let i = 0; i < chunks.length; i += 1) {
    await SecureStore.setItemAsync(chunkKey(key, nonce, i), chunks[i], writeOptions());
  }
  // 3. Interrupteur unique : l'enregistrement pointe sur la nouvelle génération.
  await SecureStore.setItemAsync(metaKey(key), `v2:${nonce}:${chunks.length}:${value.length}`, writeOptions());

  // 4. Nettoyage au mieux des générations précédentes (l'ancienne vivante est désormais périmée) ; une panne ici ne remet pas en cause l'écriture.
  try {
    const stillStale: Generation[] = [];
    for (const gen of tracked) if ((await deleteGeneration(key, gen)) !== null) stillStale.push(gen);
    await SecureStore.setItemAsync(
      journalKey(key),
      serializeJournal([...(await pruneStale(key, stillStale)), { nonce, count: chunks.length }]),
      writeOptions(),
    );
  } catch {
    /* ignore : le journal garde la trace, le prochain setItem / removeItem terminera le nettoyage */
  }
}

async function readKeychain(key: string): Promise<string | null> {
  try {
    const meta = await readMeta(key);
    if (!meta || meta.count < 1) return null;
    let value = '';
    for (let i = 0; i < meta.count; i += 1) {
      const part = await SecureStore.getItemAsync(chunkKey(key, meta.nonce, i));
      if (part === null) return null; // fragment manquant
      value += part;
    }
    return value.length === meta.length ? value : null; // fragment altéré
  } catch {
    return null;
  }
}

async function removeKeychain(key: string): Promise<void> {
  const meta = await readMeta(key).catch(() => null);
  const gens = await readJournal(key);
  if (meta && !gens.some((g) => g.nonce === meta.nonce)) gens.push(meta);

  // L'enregistrement d'abord : dès cet instant plus aucune lecture ne reconstitue la session, même si une
  // suppression de fragment échoue ensuite.
  let metaError: unknown = null;
  try {
    await SecureStore.deleteItemAsync(metaKey(key));
  } catch (e) {
    metaError = e;
  }
  // Toutes les générations sont tentées, quoi qu'il arrive (une erreur n'en dispense pas les suivantes).
  let fragmentError: unknown = null;
  for (const gen of gens) {
    const e = await deleteGeneration(key, gen);
    fragmentError ??= e;
  }
  // Le journal, supprimé en dernier, n'est retiré que si tout est parti : sinon il permet de relancer le balayage.
  if (fragmentError === null) {
    try {
      await SecureStore.deleteItemAsync(journalKey(key));
    } catch (e) {
      fragmentError = e;
    }
  }
  // Échec de l'enregistrement : la session reste lisible, on le signale. Une fois l'enregistrement supprimé, les
  // restes de fragments (illisibles, tracés par le journal) ne doivent pas empêcher le SDK d'émettre SIGNED_OUT.
  if (metaError !== null) throw metaError;
}

/** File d'attente par clé : lectures/écritures/suppressions d'une même clé s'exécutent l'une après l'autre. */
const queues = new Map<string, Promise<unknown>>();
function serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  // `previous` est toujours « réglée » (jamais rejetée) : une opération en échec n'empoisonne pas la file.
  const run = previous.then(operation);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}

async function getItemUnsafe(key: string): Promise<string | null> {
  if (!useKeychain()) return AsyncStorage.getItem(key);

  const secure = await readKeychain(key);
  if (secure !== null) return secure;

  // Migration unique : session laissée dans AsyncStorage par une version précédente de l'app.
  const legacy = await AsyncStorage.getItem(key);
  if (legacy === null) return null;
  try {
    await writeKeychain(key, legacy);
  } catch {
    // Trousseau indisponible : on garde la session lisible (l'utilisateur reste connecté) et on
    // laisse l'entrée AsyncStorage pour retenter la migration au prochain démarrage.
    return legacy;
  }
  await AsyncStorage.removeItem(key);
  return legacy;
}

async function setItemUnsafe(key: string, value: string): Promise<void> {
  if (!useKeychain()) return AsyncStorage.setItem(key, value);

  await writeKeychain(key, value);
  // Plus aucune copie en clair : une éventuelle entrée héritée est supprimée.
  await AsyncStorage.removeItem(key);
}

async function removeItemUnsafe(key: string): Promise<void> {
  if (!useKeychain()) return AsyncStorage.removeItem(key);

  try {
    await removeKeychain(key);
  } finally {
    // Toujours, même si le trousseau a échoué : sinon la migration ressusciterait une session AsyncStorage.
    await AsyncStorage.removeItem(key);
  }
}

export const secureSessionStorage = {
  getItem: (key: string): Promise<string | null> => serialized(key, () => getItemUnsafe(key)),
  setItem: (key: string, value: string): Promise<void> => serialized(key, () => setItemUnsafe(key, value)),
  removeItem: (key: string): Promise<void> => serialized(key, () => removeItemUnsafe(key)),
};
