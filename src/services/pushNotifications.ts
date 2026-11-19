import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { supabase } from '@/lib/supabase';
import { markNotificationRead, notificationRoute } from '@/services/notifications';

/**
 * Notifications push (jetons Expo). TOUT est « best effort » : RPC absente (backend pas encore migré),
 * permission refusée, simulateur, Expo Go Android (push distant non supporté), FCM manquant… →
 * log discret, jamais d'erreur à l'écran ni de plantage.
 */

const CHANNEL_ID = 'default';
const BRAND_COLOR = '#128D74';

let lastToken: string | null = null;

function debug(message: string, error?: unknown) {
  if (__DEV__) console.log(`[push] ${message}`, error instanceof Error ? error.message : (error ?? ''));
}

/** Bannière + son quand une notification arrive app ouverte. À appeler une fois au démarrage. */
export function configurePushHandler(): void {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch (e) {
    debug('setNotificationHandler indisponible', e);
  }
}

function projectId(): string | undefined {
  const id = (Constants.expoConfig?.extra as any)?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
  return typeof id === 'string' && id ? id : undefined;
}

/** Demande la permission (si besoin), récupère le jeton Expo et l'enregistre. Renvoie le jeton ou null. */
export async function registerForPush(): Promise<string | null> {
  try {
    if (!supabase) return null;
    if (!Device.isDevice) {
      debug('simulateur : push ignoré');
      return null;
    }
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'VisioDoc',
        importance: Notifications.AndroidImportance.MAX,
        lightColor: BRAND_COLOR,
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') {
      debug('permission refusée');
      return null;
    }
    const id = projectId();
    const { data: token } = await Notifications.getExpoPushTokenAsync(id ? { projectId: id } : undefined);
    if (!token) return null;
    const { error } = await supabase.rpc('register_push_token', {
      p_token: token,
      p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
      p_device_name: Device.modelName ?? null,
      p_app_version: Constants.expoConfig?.version ?? null,
    });
    if (error) {
      debug('register_push_token en erreur', error as any);
      return null;
    }
    lastToken = token;
    return token;
  } catch (e) {
    debug('enregistrement impossible', e);
    return null;
  }
}

/** Désenregistre le jeton de cet appareil. À appeler AVANT signOut (la RPC exige la session). */
export async function unregisterPush(): Promise<void> {
  const token = lastToken;
  if (!token || !supabase) return;
  lastToken = null;
  try {
    const { error } = await supabase.rpc('unregister_push_token', { p_token: token });
    if (error) debug('unregister_push_token en erreur', error as any);
  } catch (e) {
    debug('désenregistrement impossible', e);
  }
}

const handledResponses = new Set<string>();

/**
 * Tap sur une notification : marque la notification in-app lue (notificationId) puis navigue avec le
 * routage par type de la liste in-app. `navigate` reçoit le chemin d'écran. Un même tap n'est traité qu'une fois.
 */
export function handleNotificationResponse(
  response: Notifications.NotificationResponse | null | undefined,
  role: 'patient' | 'provider',
  navigate: (href: string) => void,
): boolean {
  try {
    if (!response) return false;
    const key = `${response.notification.request.identifier}:${response.actionIdentifier}`;
    if (handledResponses.has(key)) return false;
    handledResponses.add(key);
    const data = (response.notification.request.content.data ?? {}) as {
      type?: string;
      action_url?: string | null;
      notificationId?: string;
    };
    if (data.notificationId) markNotificationRead(data.notificationId).catch(() => {});
    const href = notificationRoute(data.type ?? '', role, data.action_url);
    if (href) navigate(href);
    return !!href;
  } catch (e) {
    debug('tap notification ignoré', e);
    return false;
  }
}

/** Écoute les taps (app ouverte/arrière-plan) et traite celui qui a lancé l'app. Renvoie la fonction d'arrêt. */
export function listenForNotificationTaps(
  role: 'patient' | 'provider',
  navigate: (href: string) => void,
): () => void {
  try {
    const sub = Notifications.addNotificationResponseReceivedListener((r) =>
      handleNotificationResponse(r, role, navigate),
    );
    Notifications.getLastNotificationResponseAsync()
      .then((r) => handleNotificationResponse(r, role, navigate))
      .catch(() => {});
    return () => sub.remove();
  } catch (e) {
    debug('écoute des taps indisponible', e);
    return () => {};
  }
}

/** Réinitialisation pour les tests. */
export function __resetPushStateForTests() {
  lastToken = null;
  handledResponses.clear();
}
