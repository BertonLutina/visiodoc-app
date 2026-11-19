import { useEffect } from 'react';
import { router } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { configurePushHandler, listenForNotificationTaps, registerForPush } from '@/services/pushNotifications';

configurePushHandler();

/**
 * Enregistre le jeton push dès qu'un utilisateur est connecté (connexion, restauration de session,
 * déverrouillage biométrique : tous passent par `user`) et traite les taps sur notification.
 */
export function usePushNotifications() {
  const { user } = useAuth();
  const uid = user?.id;
  const role = user?.role === 'provider' ? 'provider' : 'patient';

  useEffect(() => {
    if (!uid) return;
    registerForPush().catch(() => {});
    return listenForNotificationTaps(role, (href) => router.push(href as never));
  }, [uid, role]);
}
