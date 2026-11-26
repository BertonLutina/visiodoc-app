import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BrandLogo, wordmarkColor } from '@/components/BrandLogo';
import { colors } from '@/theme/colors';
import { BRAND_WORDMARK_FONT } from '@/theme/brand';

/** Mention du bas de l'écran de chargement. Volontairement NON traduite (langue inconnue à ce stade). */
export const POWERED_BY_TEXT = 'Powered by NEOTECH';

/** Taille du mot « VisioDoc » sous le logo (environ 2x l'ancienne taille de 28). */
export const BOOT_WORDMARK_SIZE = 56;

/** Écran de chargement JS : logo, mot VisioDoc en grand, pas de slogan, mention éditeur en bas. */
export function BootSplash() {
  return (
    <SafeAreaView className="flex-1 bg-bg" accessibilityLabel="VisioDoc">
      <View className="flex-1 items-center justify-center px-6">
        <BrandLogo size={96} />
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{
            marginTop: 16,
            maxWidth: '100%',
            fontFamily: BRAND_WORDMARK_FONT,
            fontSize: BOOT_WORDMARK_SIZE,
            color: wordmarkColor('light'),
          }}
        >
          VisioDoc
        </Text>
        <View className="mt-6">
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
      <Text
        style={{ textAlign: 'center', paddingBottom: 12, fontSize: 12, letterSpacing: 0.4, color: colors.muted }}
      >
        {POWERED_BY_TEXT}
      </Text>
    </SafeAreaView>
  );
}
