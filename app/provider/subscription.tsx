import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Lock } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { useT } from '@/i18n';
import { useAuth } from '@/contexts/AuthContext';
import { subscriptionScreenState } from '@/services/accessPolicy';

/**
 * Aucun paiement d'abonnement n'existe dans l'application : tous les profils voient la même explication
 * (ni plans, ni prix, ni bouton « S'abonner »). Un prestataire à accès limité y arrive sans autre écran
 * possible : il peut se déconnecter ; les autres disposent d'un bouton retour.
 */
export default function Subscription() {
  const t = useT();
  const { user, logout } = useAuth();
  const { showLogout, showBack } = subscriptionScreenState(user);
  const onLogout = async () => {
    await logout();
    router.replace('/(auth)/login-provider');
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        {showBack ? (
          <Pressable onPress={() => router.back()} className="p-1 mr-2" accessibilityRole="button" accessibilityLabel={t('Retour')}>
            <ChevronLeft color={colors.ink} size={26} />
          </Pressable>
        ) : null}
        <Text className="font-sans-bold text-lg text-ink">{t('Abonnement')}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 24, paddingBottom: 32 }}>
        <View className="items-center">
          <View className="w-16 h-16 rounded-full bg-accent-50 items-center justify-center mb-5">
            <Lock color={colors.accent} size={28} />
          </View>
          <Text className="font-sans text-base text-ink text-center" style={{ lineHeight: 24 }}>
            {t("L'abonnement sera bientôt disponible dans l'application. Ton accès est limité en attendant.")}
          </Text>
        </View>
        {showLogout ? (
          <Pressable onPress={onLogout} className="py-4 items-center mt-6" accessibilityRole="button">
            <Text className="font-sans-bold text-muted">{t('Se déconnecter')}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
