import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Coins } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { useT } from '@/i18n';

/**
 * Aucune source réelle de tarif ni d'écriture n'est branchée côté application : cet écran n'affiche
 * ni tarif, ni calcul de frais, ni bouton d'enregistrement (accessible uniquement par lien profond).
 */
export default function FeeScreen() {
  const t = useT();

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2" accessibilityRole="button" accessibilityLabel={t('Retour')}>
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">{t('Tarif consultation')}</Text>
      </View>
      <View className="flex-1 items-center justify-center px-8">
        <View className="w-16 h-16 rounded-full bg-accent-50 items-center justify-center mb-5">
          <Coins color={colors.accent} size={28} />
        </View>
        <Text className="font-sans text-base text-ink text-center" style={{ lineHeight: 24 }}>
          {t("La gestion du tarif sera bientôt disponible dans l'application.")}
        </Text>
      </View>
    </SafeAreaView>
  );
}
