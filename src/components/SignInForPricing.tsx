import React from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { Lock } from 'lucide-react-native';
import { Button } from '@/components/ui';
import { colors } from '@/theme/colors';
import { useT } from '@/i18n';

/**
 * Remplace tarif + créneaux quand `shouldHideCommercialInfo` est vrai.
 * Le bouton vers la connexion n'a de sens que pour un visiteur ; un utilisateur connecté dont le
 * tarif est `null` voit seulement le message.
 */
export function SignInForPricing({ signedIn, className = '' }: { signedIn: boolean; className?: string }) {
  const t = useT();
  return (
    <View className={`bg-surface border border-line rounded-3xl p-5 items-center ${className}`}>
      <View className="w-12 h-12 rounded-2xl bg-sand items-center justify-center mb-3">
        <Lock color={colors.clay} size={22} />
      </View>
      <Text className="font-sans-semibold text-ink text-center mb-4">
        {t('Connecte-toi pour voir le tarif et les disponibilités')}
      </Text>
      {!signedIn && <Button label={t('Se connecter')} onPress={() => router.push('/(auth)/login')} />}
    </View>
  );
}
