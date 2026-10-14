import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { ChevronLeft } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { useT } from '@/i18n';
import { buildPaymentFormHtml } from '@/utils/paymentForm';
import { RETURN_PATH } from '@/services/patientApi';

/** Reçoit `intent` (PaymentIntent sérialisé en JSON) et le soumet à la passerelle. */
export default function PaymentScreen() {
  const t = useT();
  const { intent } = useLocalSearchParams<{ intent?: string }>();
  const returnUrl = useMemo(() => Linking.createURL(RETURN_PATH), []);

  const html = useMemo(() => {
    try {
      return intent ? buildPaymentFormHtml(JSON.parse(intent)) : null;
    } catch {
      return null;
    }
  }, [intent]);

  const done = () => router.replace('/(patient)/appointments');

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={done} className="p-1 mr-2">
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">{t('Paiement')}</Text>
      </View>
      {html ? (
        <WebView
          originWhitelist={['*']}
          source={{ html }}
          // La passerelle redirige vers callbackUrl (schéma de l'app) : on intercepte et on revient.
          onShouldStartLoadWithRequest={(req) => {
            if (req.url.startsWith(returnUrl) || req.url.startsWith('visiodoc://')) {
              done();
              return false;
            }
            return true;
          }}
        />
      ) : (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="font-sans text-muted text-center">{t('Paiement indisponible.')}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}
