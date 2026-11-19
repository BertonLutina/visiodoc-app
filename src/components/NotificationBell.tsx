import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Bell } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/i18n';
import { countUnreadNotifications, subscribeToNotifications } from '@/services/notifications';

/** Cloche de l'en-tête : badge du nombre de non lues, ouvre la liste (`/inbox`). */
export function NotificationBell() {
  const t = useT();
  const { user } = useAuth();
  const uid = user?.id;
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    if (!uid) return;
    countUnreadNotifications(uid).then(setCount).catch(() => {});
  }, [uid]);

  // Recompte au retour sur l'écran (après lecture dans la liste).
  useFocusEffect(refresh);

  useEffect(() => {
    if (!uid) return;
    return subscribeToNotifications(uid, () => setCount((c) => c + 1));
  }, [uid]);

  if (!uid) return null;
  return (
    <Pressable
      onPress={() => router.push('/inbox')}
      accessibilityRole="button"
      accessibilityLabel={t('Notifications')}
      hitSlop={8}
      className="w-11 h-11 rounded-full bg-white items-center justify-center mr-2 border border-line"
    >
      <Bell size={20} color={colors.ink} />
      {count > 0 && (
        <View
          className="absolute -top-1 -right-1 rounded-full items-center justify-center px-1"
          style={{ minWidth: 18, height: 18, backgroundColor: colors.danger }}
        >
          <Text className="font-sans-bold text-white" style={{ fontSize: 10 }}>
            {count > 9 ? '9+' : count}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
