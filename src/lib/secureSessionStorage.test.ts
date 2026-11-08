import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { secureSessionStorage } from './secureSessionStorage';

// Frontière externe : le trousseau. Le mock reproduit la contrainte de la plateforme
// (clés limitées à [A-Za-z0-9._-], valeurs ≤ 2048 octets) pour que le test échoue si l'adaptateur la viole.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  const bytes = (v: string) => unescape(encodeURIComponent(v)).length; // octets UTF-8
  const check = (key: string) => {
    if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new Error(`Invalid SecureStore key: ${key}`);
  };
  const impl = {
    get: async (key: string) => {
      check(key);
      return store.has(key) ? (store.get(key) as string) : null;
    },
    set: async (key: string, value: string) => {
      check(key);
      if (bytes(value) > 2048) throw new Error(`Value too large (${bytes(value)} bytes)`);
      store.set(key, value);
    },
    del: async (key: string) => {
      check(key);
      store.delete(key);
    },
  };
  return {
    __store: store,
    __impl: impl,
    AFTER_FIRST_UNLOCK: 'AFTER_FIRST_UNLOCK_CONSTANT',
    getItemAsync: jest.fn(impl.get),
    setItemAsync: jest.fn(impl.set),
    deleteItemAsync: jest.fn(impl.del),
  };
});

const utf8Bytes = (v: string) => unescape(encodeURIComponent(v)).length;
const secureMap: Map<string, string> = (SecureStore as any).__store;
const impl = (SecureStore as any).__impl;
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
  // clearAllMocks ne retire pas les implémentations d'échec posées par un test précédent.
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(impl.get);
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(impl.set);
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(impl.del);
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
    // Une seule génération reste : journal + métadonnée + un fragment.
    expect(secureMap.size).toBe(3);
    expect([...secureMap.keys()].filter((k) => /\.__\d+$/.test(k))).toHaveLength(1);
  });

  it('returns null when a chunk is missing', async () => {
    await secureSessionStorage.setItem(KEY, bigSession());
    const chunkKey = [...secureMap.keys()].find((k) => /\.__1$/.test(k)) as string;
    secureMap.delete(chunkKey);

    expect(await secureSessionStorage.getItem(KEY)).toBeNull();
  });

  it('returns null when a chunk is corrupt', async () => {
    await secureSessionStorage.setItem(KEY, bigSession());
    const chunkKey = [...secureMap.keys()].find((k) => /\.__0$/.test(k)) as string;
    secureMap.set(chunkKey, (secureMap.get(chunkKey) as string).slice(10));

    expect(await secureSessionStorage.getItem(KEY)).toBeNull();
  });

  it('returns null when the chunk count is garbage', async () => {
    await secureSessionStorage.setItem(KEY, bigSession());
    const metaKey = [...secureMap.keys()].find((k) => k.endsWith('.__n')) as string;
    secureMap.set(metaKey, 'not-a-number');

    expect(await secureSessionStorage.getItem(KEY)).toBeNull();
  });

  describe('atomic writes', () => {
    const OLD = 'old-' + 'o'.repeat(4000);
    const NEW = 'new-' + 'n'.repeat(5000);

    // Combien d'appels setItemAsync une réécriture fait-elle ? (mesuré, pas supposé)
    async function countWriteCalls(): Promise<number> {
      secureMap.clear();
      await secureSessionStorage.setItem(KEY, OLD);
      (SecureStore.setItemAsync as jest.Mock).mockClear();
      await secureSessionStorage.setItem(KEY, NEW);
      return (SecureStore.setItemAsync as jest.Mock).mock.calls.length;
    }

    it.each([['first', 1], ['second', 2]])('keeps the old value when the %s write fails', async (_label, n) => {
      await secureSessionStorage.setItem(KEY, OLD);
      let calls = 0;
      (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (k: string, v: string) => {
        calls += 1;
        if (calls === n) throw new Error('write failed');
        return impl.set(k, v);
      });

      await expect(secureSessionStorage.setItem(KEY, NEW)).rejects.toThrow('write failed');

      expect(await secureSessionStorage.getItem(KEY)).toBe(OLD);
    });

    it('keeps the old value when the LAST chunk write fails', async () => {
      const total = await countWriteCalls();
      await secureSessionStorage.removeItem(KEY);
      await secureSessionStorage.setItem(KEY, OLD);
      let calls = 0;
      (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (k: string, v: string) => {
        calls += 1;
        if (calls === total - 2) throw new Error('write failed'); // dernier fragment (avant la métadonnée et le journal de nettoyage)
        return impl.set(k, v);
      });

      await expect(secureSessionStorage.setItem(KEY, NEW)).rejects.toThrow('write failed');

      expect(await secureSessionStorage.getItem(KEY)).toBe(OLD);
    });

    it('keeps the old value when the meta write fails', async () => {
      const total = await countWriteCalls();
      await secureSessionStorage.removeItem(KEY);
      await secureSessionStorage.setItem(KEY, OLD);
      let calls = 0;
      (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (k: string, v: string) => {
        calls += 1;
        if (calls === total - 1) throw new Error('meta write failed'); // la métadonnée précède l'écriture finale du journal de nettoyage
        return impl.set(k, v);
      });

      await expect(secureSessionStorage.setItem(KEY, NEW)).rejects.toThrow('meta write failed');

      expect(await secureSessionStorage.getItem(KEY)).toBe(OLD);
    });

    it('never reads back a mix of old and new chunks, whichever write call fails', async () => {
      const total = await countWriteCalls();
      for (let failAt = 1; failAt <= total - 1; failAt += 1) { // total = dernière écriture = journal de nettoyage, après l'interrupteur
        secureMap.clear();
        await secureSessionStorage.setItem(KEY, OLD);
        let calls = 0;
        (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (k: string, v: string) => {
          calls += 1;
          if (calls === failAt) throw new Error('write failed');
          return impl.set(k, v);
        });
        await secureSessionStorage.setItem(KEY, NEW).catch(() => {});
        (SecureStore.setItemAsync as jest.Mock).mockImplementation(impl.set);

        expect([OLD, null]).toContain(await secureSessionStorage.getItem(KEY));
        expect(await secureSessionStorage.getItem(KEY)).toBe(OLD);
      }
    });

    it('keeps the NEW value when only the final journal cleanup write fails', async () => {
      const total = await countWriteCalls();
      secureMap.clear();
      await secureSessionStorage.setItem(KEY, OLD);
      let calls = 0;
      (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (k: string, v: string) => {
        calls += 1;
        if (calls === total) throw new Error('journal rewrite failed');
        return impl.set(k, v);
      });

      await expect(secureSessionStorage.setItem(KEY, NEW)).resolves.toBeUndefined();

      expect(await secureSessionStorage.getItem(KEY)).toBe(NEW);
    });

    it('returns null (never a partial value) when the very first write fails midway', async () => {
      let calls = 0;
      (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (k: string, v: string) => {
        calls += 1;
        if (calls === 3) throw new Error('write failed');
        return impl.set(k, v);
      });

      await expect(secureSessionStorage.setItem(KEY, NEW)).rejects.toThrow('write failed');

      expect(await secureSessionStorage.getItem(KEY)).toBeNull();
    });

    it('does not fail the write when cleaning up the previous generation fails', async () => {
      await secureSessionStorage.setItem(KEY, OLD);
      (SecureStore.deleteItemAsync as jest.Mock).mockRejectedValue(new Error('delete failed'));

      await expect(secureSessionStorage.setItem(KEY, NEW)).resolves.toBeUndefined();

      expect(await secureSessionStorage.getItem(KEY)).toBe(NEW);
    });

    it('sweeps a failed generation on the next successful write', async () => {
      await secureSessionStorage.setItem(KEY, OLD);
      let calls = 0;
      (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (k: string, v: string) => {
        calls += 1;
        if (calls === 4) throw new Error('write failed');
        return impl.set(k, v);
      });
      await secureSessionStorage.setItem(KEY, NEW).catch(() => {});
      (SecureStore.setItemAsync as jest.Mock).mockImplementation(impl.set);

      await secureSessionStorage.setItem(KEY, 'final');

      expect(await secureSessionStorage.getItem(KEY)).toBe('final');
      expect(secureMap.size).toBe(3); // journal + métadonnée + un fragment : rien d'orphelin
    });

    it('never prunes the live generation: 11 consecutive failed writes keep the old value readable', async () => {
      await secureSessionStorage.setItem(KEY, OLD);
      // Chaque échec écrit le journal puis échoue sur un fragment : une génération périmée de plus à suivre.
      (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (k: string, v: string) => {
        if (/\.g[A-Za-z0-9]+\.__\d+$/.test(k)) throw new Error('chunk write failed');
        return impl.set(k, v);
      });
      for (let i = 0; i < 11; i += 1) {
        await expect(secureSessionStorage.setItem(KEY, NEW)).rejects.toThrow('chunk write failed');
      }
      (SecureStore.setItemAsync as jest.Mock).mockImplementation(impl.set);

      expect(await secureSessionStorage.getItem(KEY)).toBe(OLD);
    });

    it('writes with AFTER_FIRST_UNLOCK so a locked device does not log the user out', async () => {
      await secureSessionStorage.setItem(KEY, bigSession());

      const calls = (SecureStore.setItemAsync as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) expect(call[2]).toEqual({ keychainAccessible: 'AFTER_FIRST_UNLOCK_CONSTANT' });
    });
  });

  describe('chunk boundaries', () => {
    const CHUNK = 1800;
    const utf8 = (v: string) => unescape(encodeURIComponent(v)).length;

    it('stores a value of exactly the chunk size in one chunk', async () => {
      const value = 'x'.repeat(CHUNK);
      await secureSessionStorage.setItem(KEY, value);
      expect([...secureMap.keys()].filter((k) => /\.__\d+$/.test(k))).toHaveLength(1);
      expect(await secureSessionStorage.getItem(KEY)).toBe(value);
    });

    it('splits a value one byte over the chunk size in two chunks', async () => {
      const value = 'x'.repeat(CHUNK + 1);
      await secureSessionStorage.setItem(KEY, value);
      expect([...secureMap.keys()].filter((k) => /\.__\d+$/.test(k))).toHaveLength(2);
      expect(await secureSessionStorage.getItem(KEY)).toBe(value);
    });

    it.each([
      ['2-byte', 'é'],
      ['3-byte', '€'],
      ['4-byte (surrogate pair)', '😀'],
    ])('keeps a %s character that straddles a chunk boundary intact', async (_label, ch) => {
      for (const pad of [CHUNK - 1, CHUNK - 2, CHUNK - 3]) {
        const value = 'a'.repeat(pad) + ch + 'tail' + ch.repeat(10);
        await secureSessionStorage.setItem(KEY, value);
        for (const v of secureMap.values()) expect(utf8(v)).toBeLessThanOrEqual(2048);
        expect(await secureSessionStorage.getItem(KEY)).toBe(value);
      }
    });
  });

  describe('key escaping', () => {
    it('maps keys that differ only by a forbidden character to different storage keys', async () => {
      await secureSessionStorage.setItem('a:b', 'colon');
      await secureSessionStorage.setItem('a_b', 'underscore');
      await secureSessionStorage.setItem('a/b', 'slash');

      expect(await secureSessionStorage.getItem('a:b')).toBe('colon');
      expect(await secureSessionStorage.getItem('a_b')).toBe('underscore');
      expect(await secureSessionStorage.getItem('a/b')).toBe('slash');
      for (const k of secureMap.keys()) expect(k).toMatch(/^[A-Za-z0-9._-]+$/);
    });

    it('removing one key leaves the key that used to collide with it untouched', async () => {
      await secureSessionStorage.setItem('a:b', 'colon');
      await secureSessionStorage.setItem('a_b', 'underscore');
      await secureSessionStorage.removeItem('a:b');
      expect(await secureSessionStorage.getItem('a_b')).toBe('underscore');
      expect(await secureSessionStorage.getItem('a:b')).toBeNull();
    });
  });

  describe('removeItem robustness', () => {
    it('still deletes the AsyncStorage legacy copy when the keychain delete throws', async () => {
      await secureSessionStorage.setItem(KEY, bigSession());
      await AsyncStorage.setItem(KEY, 'legacy');
      (SecureStore.deleteItemAsync as jest.Mock).mockRejectedValue(new Error('keychain locked'));

      await expect(secureSessionStorage.removeItem(KEY)).rejects.toThrow('keychain locked');

      expect(await AsyncStorage.getItem(KEY)).toBeNull();
    });

    it('sweeps chunks even when the meta record is gone', async () => {
      await secureSessionStorage.setItem(KEY, bigSession());
      const metaKey = [...secureMap.keys()].find((k) => k.endsWith('.__n')) as string;
      secureMap.delete(metaKey);
      expect(secureMap.size).toBeGreaterThan(0);

      await secureSessionStorage.removeItem(KEY);

      expect(secureMap.size).toBe(0);
    });

    it('lets a retry finish the job after a fragment delete failed, leaving no token fragment', async () => {
      await secureSessionStorage.setItem(KEY, bigSession());
      let calls = 0;
      (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (k: string) => {
        calls += 1;
        if (calls === 2) throw new Error('delete failed');
        return impl.del(k);
      });

      // La métadonnée est partie : la déconnexion aboutit (le SDK peut émettre SIGNED_OUT).
      await expect(secureSessionStorage.removeItem(KEY)).resolves.toBeUndefined();
      expect(await secureSessionStorage.getItem(KEY)).toBeNull();
      expect(secureMap.size).toBeGreaterThan(0); // un fragment + le journal restent pour le balayage suivant

      (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(impl.del);
      await secureSessionStorage.removeItem(KEY);

      expect(secureMap.size).toBe(0);
    });

    it('still rejects when the META delete itself fails', async () => {
      await secureSessionStorage.setItem(KEY, bigSession());
      (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (k: string) => {
        if (k.endsWith('.__n')) throw new Error('meta delete failed');
        return impl.del(k);
      });

      await expect(secureSessionStorage.removeItem(KEY)).rejects.toThrow('meta delete failed');
    });

    it('attempts every generation (the current one included) even after a delete failed', async () => {
      const OLD = 'old-' + 'o'.repeat(4000);
      const NEW = 'new-' + 'n'.repeat(4000);
      await secureSessionStorage.setItem(KEY, OLD);
      // Le nettoyage de l'ancienne génération échoue : le journal en garde deux.
      let failing = true;
      (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (k: string) => {
        if (failing) throw new Error('delete failed');
        return impl.del(k);
      });
      await secureSessionStorage.setItem(KEY, NEW);
      const generations = new Set(
        [...secureMap.keys()].map((k) => /\.g([A-Za-z0-9]+)\.__\d+$/.exec(k)?.[1]).filter(Boolean),
      );
      expect(generations.size).toBe(2);

      // Un seul fragment refuse de se supprimer ; tous les autres doivent partir.
      const stuck = [...secureMap.keys()].find((k) => /\.__0$/.test(k)) as string;
      failing = false;
      (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (k: string) => {
        if (k === stuck) throw new Error('delete failed');
        return impl.del(k);
      });

      await secureSessionStorage.removeItem(KEY);

      expect([...secureMap.keys()].filter((k) => k !== `${stuck.split('.g')[0]}.__j`)).toEqual([stuck]);
    });

    it('sweeps the generation left behind by a failed write', async () => {
      await secureSessionStorage.setItem(KEY, 'old-' + 'o'.repeat(4000));
      let calls = 0;
      (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (k: string, v: string) => {
        calls += 1;
        if (calls === 4) throw new Error('write failed');
        return impl.set(k, v);
      });
      await secureSessionStorage.setItem(KEY, 'new-' + 'n'.repeat(5000)).catch(() => {});
      (SecureStore.setItemAsync as jest.Mock).mockImplementation(impl.set);

      await secureSessionStorage.removeItem(KEY);

      expect(secureMap.size).toBe(0);
    });
  });

  describe('journal bound', () => {
    const journalEntries = (): number => {
      const raw = [...secureMap.entries()].find(([k]) => k.endsWith('.__j'))?.[1] ?? '';
      return raw ? raw.split(',').length : 0;
    };

    it('stays small when cleanups keep failing, and never breaks a write', async () => {
      (SecureStore.deleteItemAsync as jest.Mock).mockRejectedValue(new Error('delete failed'));
      for (let i = 0; i < 40; i += 1) {
        await expect(secureSessionStorage.setItem(KEY, `session-${i}-` + 'x'.repeat(3000))).resolves.toBeUndefined();
      }
      expect(journalEntries()).toBeLessThanOrEqual(11); // 10 générations périmées + la courante
      expect(await secureSessionStorage.getItem(KEY)).toBe('session-39-' + 'x'.repeat(3000));
      for (const v of secureMap.values()) expect(utf8Bytes(v)).toBeLessThanOrEqual(2048);
    });

    it('makes one last delete attempt on the generations it drops', async () => {
      (SecureStore.deleteItemAsync as jest.Mock).mockRejectedValue(new Error('delete failed'));
      for (let i = 0; i < 14; i += 1) await secureSessionStorage.setItem(KEY, `v${i}`);
      // Le trousseau redevient disponible : les prochaines écritures balayent ce qui est encore suivi.
      (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(impl.del);
      await secureSessionStorage.setItem(KEY, 'final');
      expect(journalEntries()).toBe(1);
      expect(await secureSessionStorage.getItem(KEY)).toBe('final');
    });
  });

  describe('per-key serialisation', () => {
    it('a concurrent setItem and getItem never returns null when an old value existed', async () => {
      const OLD = 'old-' + 'o'.repeat(4000);
      await secureSessionStorage.setItem(KEY, OLD);
      for (let round = 0; round < 15; round += 1) {
        const NEW = `new-${round}-` + 'n'.repeat(4000);
        const [, ...reads] = await Promise.all([
          secureSessionStorage.setItem(KEY, NEW),
          secureSessionStorage.getItem(KEY),
          secureSessionStorage.getItem(KEY),
          secureSessionStorage.getItem(KEY),
        ]);
        for (const r of reads) expect(r).not.toBeNull();
      }
    });

    it('removeItem after overlapping setItems leaves no keys', async () => {
      await Promise.all([
        secureSessionStorage.setItem(KEY, 'a' + 'x'.repeat(4000)),
        secureSessionStorage.setItem(KEY, 'b' + 'y'.repeat(4000)),
        secureSessionStorage.setItem(KEY, 'c' + 'z'.repeat(4000)),
      ]);
      await secureSessionStorage.removeItem(KEY);
      expect(secureMap.size).toBe(0);
    });

    it('keeps operations in call order for the same key', async () => {
      const results = await Promise.all([
        secureSessionStorage.setItem(KEY, 'first'),
        secureSessionStorage.setItem(KEY, 'second'),
        secureSessionStorage.getItem(KEY),
        secureSessionStorage.removeItem(KEY),
        secureSessionStorage.getItem(KEY),
      ]);
      expect(results[2]).toBe('second');
      expect(results[4]).toBeNull();
    });

    it('a rejected operation does not poison the chain', async () => {
      (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error('boom'));
      const failed = secureSessionStorage.setItem(KEY, 'lost');
      const next = secureSessionStorage.setItem(KEY, 'kept');
      await expect(failed).rejects.toThrow('boom');
      await expect(next).resolves.toBeUndefined();
      expect(await secureSessionStorage.getItem(KEY)).toBe('kept');
    });

    it('does not serialise different keys against each other', async () => {
      let release: () => void = () => {};
      const gate = new Promise<void>((r) => (release = r));
      (SecureStore.getItemAsync as jest.Mock).mockImplementationOnce(async (k: string) => {
        await gate;
        return impl.get(k);
      });
      const slow = secureSessionStorage.getItem('slow-key');
      await secureSessionStorage.setItem('other-key', 'v');
      expect(await secureSessionStorage.getItem('other-key')).toBe('v');
      release();
      await slow;
    });
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
