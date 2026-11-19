import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Bell, CheckCheck, ChevronLeft } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useT, useLanguage } from '@/i18n';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationRoute,
  type InAppNotification,
} from '@/services/notifications';

export default function Inbox() {
  const t = useT();
  const { locale } = useLanguage();
  const { user } = useAuth();
  const uid = user?.id;
  const role = user?.role === 'provider' ? 'provider' : 'patient';
  const accent = role === 'provider' ? colors.accent : colors.primary;

  const [items, setItems] = useState<InAppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!uid) {
      setLoading(false);
      return;
    }
    try {
      setItems(await listNotifications(uid));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const unread = items.filter((n) => !n.read_at).length;

  const onOpen = async (n: InAppNotification) => {
    if (!n.read_at) {
      const now = new Date().toISOString();
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: now } : x)));
      markNotificationRead(n.id, now).catch(() => {});
    }
    const href = notificationRoute(n.type, role, n.action_url);
    if (href) router.push(href as never);
  };

  const onMarkAll = async () => {
    if (!uid || unread === 0) return;
    const now = new Date().toISOString();
    const before = items;
    setItems((prev) => prev.map((x) => ({ ...x, read_at: x.read_at ?? now })));
    try {
      await markAllNotificationsRead(uid, now);
    } catch {
      setItems(before);
    }
  };

  const when = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-3 pt-2 pb-3">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('Retour')}
          className="w-11 h-11 items-center justify-center"
        >
          <ChevronLeft size={26} color={colors.ink} />
        </Pressable>
        <Text className="flex-1 font-serif-bold text-2xl text-ink" numberOfLines={1}>
          {t('Notifications')}
        </Text>
      </View>
      {/* « Tout marquer comme lu » sous le titre, pour que « Notifications » tienne sur une ligne (retour de Chris, 19/11). */}
      {unread > 0 && (
        <View className="flex-row justify-end px-3 -mt-2 mb-1">
          <Pressable
            onPress={onMarkAll}
            accessibilityRole="button"
            className="flex-row items-center px-3 h-11"
          >
            <CheckCheck size={18} color={accent} />
            <Text className="font-sans-bold text-sm ml-1" style={{ color: accent }}>
              {t('Tout marquer comme lu')}
            </Text>
          </Pressable>
        </View>
      )}

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={accent} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent} colors={[accent]} />}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center pt-24 px-6">
              <Bell size={40} color={colors.muted} />
              <Text className="font-sans-bold text-base text-ink mt-4 text-center">
                {failed ? t('Impossible de charger tes notifications.') : t('Aucune notification pour le moment')}
              </Text>
              <Text className="font-sans text-sm text-muted mt-1 text-center">
                {failed ? t('Tire vers le bas pour réessayer.') : t('Tes rappels et alertes apparaîtront ici.')}
              </Text>
            </View>
          }
          renderItem={({ item: n }) => (
            <Pressable
              onPress={() => onOpen(n)}
              accessibilityRole="button"
              className={`flex-row rounded-2xl p-4 mb-3 border border-line ${n.read_at ? 'bg-white' : 'bg-primaryLight'}`}
            >
              <View
                className="w-2.5 h-2.5 rounded-full mt-1.5 mr-3"
                style={{ backgroundColor: n.read_at ? colors.line : accent }}
              />
              <View className="flex-1">
                <Text className={`text-sm text-ink ${n.read_at ? 'font-sans-medium' : 'font-sans-bold'}`}>{n.title}</Text>
                <Text className="font-sans text-sm text-muted mt-1">{n.message}</Text>
                <Text className="font-sans text-xs text-muted mt-2">{when(n.created_at)}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}
