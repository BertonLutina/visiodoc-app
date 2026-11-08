import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { secureSessionStorage } from './secureSessionStorage';

// Frontière externe : le trousseau. Le mock reproduit la contrainte de la plateforme
// (clés limitées à [A-Za-z0-9._-], valeurs ≤ 2048 octets) pour que le test échoue si l'adaptateur la viole.
jest.mock('expo-secure-store', () => {
  const bytes = (v: string) => unescape(encodeURIComponent(v)).length; // octets UTF-8
  const store = new Map<string, string>();
  const check = (key: string) => {
    if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new Error(`Invalid SecureStore key: ${key}`);
  };
  return {
    __store: store,
    getItemAsync: jest.fn(async (key: string) => {
      check(key);
      return store.has(key) ? (store.get(key) as string) : null;
    }),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      check(key);
      if (bytes(value) > 2048) throw new Error(`Value too large (${bytes(value)} bytes)`);
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      check(key);
      store.delete(key);
    }),
  };
});

const utf8Bytes = (v: string) => unescape(encodeURIComponent(v)).length;
const secureMap: Map<string, string> = (SecureStore as any).__store;
const KEY = 'sb-pslypdfjmjetjhtpzwip-auth-token';

const bigSession = () =>
  JSON.stringify({
    access_token: 'a'.repeat(1200),
    refresh_token: 'r'.repeat(40),
    user: { id: 'u1', user_metadata: { first_name: 'Élodie', note: 'é'.repeat(900) } },
  });

beforeEach(async () => {
  secureMap.clear();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  (Platform as any).OS = 'ios';
});

describe('secureSessionStorage', () => {
  it('round-trips a value larger than 2048 bytes across several chunks', async () => {
    const value = bigSession();
    expect(utf8Bytes(value)).toBeGreaterThan(2048);

    await secureSessionStorage.setItem(KEY, value);

    expect(await secureSessionStorage.getItem(KEY)).toBe(value);
    // Rien de plus de 2048 octets n'a été écrit dans le trousseau.
    for (const v of secureMap.values()) expect(utf8Bytes(v)).toBeLessThanOrEqual(2048);
    expect(secureMap.size).toBeGreaterThan(2);
  });

  it('round-trips a small value', async () => {
    await secureSessionStorage.setItem(KEY, '{"a":1}');
    expect(await secureSessionStorage.getItem(KEY)).toBe('{"a":1}');
  });

  it('returns null when nothing is stored', async () => {
    expect(await secureSessionStorage.getItem(KEY)).toBeNull();
  });

  it('never writes the session to AsyncStorage', async () => {
    await secureSessionStorage.setItem(KEY, bigSession());
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });

  it('only uses characters the keychain accepts in its keys', async () => {
    await secureSessionStorage.setItem('sb-proj:ref/auth token', bigSession());
    expect(secureMap.size).toBeGreaterThan(0);
    for (const k of secureMap.keys()) expect(k).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(await secureSessionStorage.getItem('sb-proj:ref/auth token')).toBe(bigSession());
  });

  it('removeItem clears every chunk', async () => {
    await secureSessionStorage.setItem(KEY, bigSession());
    expect(secureMap.size).toBeGreaterThan(0);

    await secureSessionStorage.removeItem(KEY);

    expect(secureMap.size).toBe(0);
    expect(await secureSessionStorage.getItem(KEY)).toBeNull();
  });

  it('leaves no stale chunk when a shorter value replaces a longer one', async () => {
    await secureSessionStorage.setItem(KEY, bigSession());
    await secureSessionStorage.setItem(KEY, 'short');
    expect(await secureSessionStorage.getItem(KEY)).toBe('short');
    expect(secureMap.size).toBe(2); // métadonnée + un seul fragment
  });

  it('returns null when a chunk is missing', async () => {
    await secureSessionStorage.setItem(KEY, bigSession());
    const chunkKey = [...secureMap.keys()].find((k) => k.endsWith('.__1')) as string;
    secureMap.delete(chunkKey);

    expect(await secureSessionStorage.getItem(KEY)).toBeNull();
  });

  it('returns null when a chunk is corrupt', async () => {
    await secureSessionStorage.setItem(KEY, bigSession());
    const chunkKey = [...secureMap.keys()].find((k) => k.endsWith('.__0')) as string;
    secureMap.set(chunkKey, (secureMap.get(chunkKey) as string).slice(10));

    expect(await secureSessionStorage.getItem(KEY)).toBeNull();
  });

  it('returns null when the chunk count is garbage', async () => {
    await secureSessionStorage.setItem(KEY, bigSession());
    const metaKey = [...secureMap.keys()].find((k) => k.endsWith('.__n')) as string;
    secureMap.set(metaKey, 'not-a-number');

    expect(await secureSessionStorage.getItem(KEY)).toBeNull();
  });

  describe('migration from AsyncStorage', () => {
    it('copies an existing session into the keychain and deletes the AsyncStorage entry', async () => {
      const legacy = bigSession();
      await AsyncStorage.setItem(KEY, legacy);

      expect(await secureSessionStorage.getItem(KEY)).toBe(legacy);

      expect(await AsyncStorage.getItem(KEY)).toBeNull();
      // Deuxième lecture : servie par le trousseau seul.
      expect(await secureSessionStorage.getItem(KEY)).toBe(legacy);
      expect(secureMap.size).toBeGreaterThan(0);
    });

    it('prefers the keychain over a stale AsyncStorage entry', async () => {
      await secureSessionStorage.setItem(KEY, 'fresh');
      await AsyncStorage.setItem(KEY, 'stale');

      expect(await secureSessionStorage.getItem(KEY)).toBe('fresh');
    });

    it('removeItem also deletes a leftover AsyncStorage entry so a logout cannot be undone by the migration', async () => {
      await AsyncStorage.setItem(KEY, 'legacy');

      await secureSessionStorage.removeItem(KEY);

      expect(await AsyncStorage.getItem(KEY)).toBeNull();
      expect(await secureSessionStorage.getItem(KEY)).toBeNull();
    });

    it('keeps the user signed in and the legacy entry when the keychain write fails', async () => {
      await AsyncStorage.setItem(KEY, 'legacy');
      (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error('keychain unavailable'));

      expect(await secureSessionStorage.getItem(KEY)).toBe('legacy');
      expect(await AsyncStorage.getItem(KEY)).toBe('legacy');
    });
  });

  describe('web platform', () => {
    it('falls back to AsyncStorage and never touches SecureStore', async () => {
      (Platform as any).OS = 'web';

      await secureSessionStorage.setItem(KEY, 'web-session');
      expect(await AsyncStorage.getItem(KEY)).toBe('web-session');
      expect(await secureSessionStorage.getItem(KEY)).toBe('web-session');
      await secureSessionStorage.removeItem(KEY);
      expect(await AsyncStorage.getItem(KEY)).toBeNull();

      expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
      expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
      expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    });
  });
});
