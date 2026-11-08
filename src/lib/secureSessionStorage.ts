import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/**
 * Stockage de la session Supabase (jetons) dans le trousseau (iOS Keychain / Android Keystore) via
 * `expo-secure-store`, pour le client d'authentification principal uniquement.
 *
 * - Une valeur SecureStore est limitée à ~2048 octets alors qu'une session Supabase (JWT + utilisateur)
 *   peut la dépasser : la valeur est découpée en fragments `${clé}.__0 … ${clé}.__n-1`, avec une
 *   métadonnée `${clé}.__n` = `nombre:longueur` qui permet de détecter un fragment manquant ou altéré.
 * - Les clés SecureStore n'acceptent que [A-Za-z0-9._-] : la clé Supabase est nettoyée.
 * - Migration : les utilisateurs déjà connectés ont leur session dans AsyncStorage (même clé). Au premier
 *   `getItem` sans valeur dans le trousseau, elle y est copiée puis supprimée d'AsyncStorage.
 * - Web : SecureStore n'existe pas → AsyncStorage.
 * - Aucun mot de passe n'est jamais écrit ici : le SDK ne persiste que la session (jetons + profil).
 */

/** Octets UTF-8 maximum par fragment (marge sous la limite de 2048 octets). */
const CHUNK_BYTES = 1800;

const sanitizeKey = (key: string): string => key.replace(/[^A-Za-z0-9._-]/g, '_');
const metaKey = (key: string): string => `${sanitizeKey(key)}.__n`;
const chunkKey = (key: string, index: number): string => `${sanitizeKey(key)}.__${index}`;

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

/** Lit la métadonnée : `null` si absente ou illisible. */
async function readMeta(key: string): Promise<{ count: number; length: number } | null> {
  const raw = await SecureStore.getItemAsync(metaKey(key));
  if (raw === null) return null;
  const match = /^(\d+):(\d+)$/.exec(raw);
  if (!match) return null;
  return { count: Number(match[1]), length: Number(match[2]) };
}

async function deleteChunks(key: string, from: number, to: number): Promise<void> {
  for (let i = from; i < to; i += 1) await SecureStore.deleteItemAsync(chunkKey(key, i));
}

async function writeKeychain(key: string, value: string): Promise<void> {
  const previous = await readMeta(key).catch(() => null);
  const chunks = splitByBytes(value, CHUNK_BYTES);
  for (let i = 0; i < chunks.length; i += 1) await SecureStore.setItemAsync(chunkKey(key, i), chunks[i]);
  // La métadonnée est écrite en dernier : une écriture interrompue n'annonce jamais des fragments absents.
  await SecureStore.setItemAsync(metaKey(key), `${chunks.length}:${value.length}`);
  if (previous && previous.count > chunks.length) await deleteChunks(key, chunks.length, previous.count);
}

async function readKeychain(key: string): Promise<string | null> {
  try {
    const meta = await readMeta(key);
    if (!meta || meta.count < 1) return null;
    let value = '';
    for (let i = 0; i < meta.count; i += 1) {
      const part = await SecureStore.getItemAsync(chunkKey(key, i));
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
  // Métadonnée illisible : on balaie quand même quelques fragments plausibles.
  await deleteChunks(key, 0, meta ? meta.count : 8);
  await SecureStore.deleteItemAsync(metaKey(key));
}

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
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
  },

  async setItem(key: string, value: string): Promise<void> {
    if (!useKeychain()) return AsyncStorage.setItem(key, value);

    await writeKeychain(key, value);
    // Plus aucune copie en clair : une éventuelle entrée héritée est supprimée.
    await AsyncStorage.removeItem(key);
  },

  async removeItem(key: string): Promise<void> {
    if (!useKeychain()) return AsyncStorage.removeItem(key);

    await removeKeychain(key);
    // Sans cela, la migration ressusciterait une session AsyncStorage après une déconnexion.
    await AsyncStorage.removeItem(key);
  },
};
