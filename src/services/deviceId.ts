import * as SecureStore from 'expo-secure-store';

const KEY = 'vd_device_id';

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 24 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/**
 * Identifiant stable de cet appareil (généré une fois, persisté localement).
 * Sert à relier les entrées du journal de connexions (`audit_logs`) à un même appareil,
 * indépendamment du compte utilisé pour se connecter.
 */
export async function getDeviceId(): Promise<string> {
  try {
    const existing = await SecureStore.getItemAsync(KEY);
    if (existing) return existing;
    const id = randomId();
    await SecureStore.setItemAsync(KEY, id);
    return id;
  } catch {
    return 'unknown-device';
  }
}
