import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

/**
 * Biométrie du téléphone (Face ID, Touch ID, empreinte) + préférences par utilisateur.
 * Toute erreur native est absorbée : la biométrie ne doit jamais bloquer l'app.
 */

const enabledKey = (userId: string) => `vd_bio_enabled_${userId}`;
const offeredKey = (userId: string) => `vd_bio_offered_${userId}`;

/** Capteur présent ET au moins une empreinte / un visage enregistré. */
export async function isAvailable(): Promise<boolean> {
  try {
    const [hasHardware, isEnrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hasHardware && isEnrolled;
  } catch {
    return false;
  }
}

/** Nom affiché de la méthode : « Face ID », « Touch ID », « Empreinte digitale »… */
export async function getLabel(): Promise<string> {
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    const finger = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
    if (Platform.OS === 'ios') return face ? 'Face ID' : 'Touch ID';
    return finger ? 'Empreinte digitale' : 'Biométrie';
  } catch {
    return 'Biométrie';
  }
}

/** Lance la demande biométrique ; le code du téléphone est accepté en secours. */
export async function authenticate(promptMessage: string): Promise<boolean> {
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: 'Annuler',
      disableDeviceFallback: false,
    });
    return res.success;
  } catch {
    return false;
  }
}

export async function isEnabled(userId: string): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(enabledKey(userId))) === '1';
  } catch {
    return false;
  }
}

export async function setEnabled(userId: string, enabled: boolean): Promise<void> {
  try {
    if (enabled) {
      await SecureStore.setItemAsync(enabledKey(userId), '1');
      await markOffered(userId);
    } else {
      await SecureStore.deleteItemAsync(enabledKey(userId));
    }
  } catch {
    /* ignore */
  }
}

export async function wasOffered(userId: string): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(offeredKey(userId))) === '1';
  } catch {
    return false;
  }
}

export async function markOffered(userId: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(offeredKey(userId), '1');
  } catch {
    /* ignore */
  }
}

/** Verrouiller au lancement : préférence activée ET biométrie encore disponible. */
export async function shouldLockAtLaunch(userId: string): Promise<boolean> {
  return (await isEnabled(userId)) && (await isAvailable());
}
