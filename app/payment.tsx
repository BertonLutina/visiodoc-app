import React, { useEffect, useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useNavigation } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { ChevronLeft } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { useT } from '@/i18n';
import { buildInlineCheckoutHtml, parseWidgetMessage } from '@/utils/paymentForm';
import { getPendingPaymentWidget, settlePaymentWidget } from '@/services/paymentWidget';

/**
 * Exécute le widget de paiement dans une WebView et rapporte l'issue (succès + payRef, annulation, erreur)
 * à la promesse `openPaymentWidget` de la réservation. Cet écran ne confirme rien et n'écrit rien :
 * `confirm-consultation-payment` est appelé par l'appelant, qui relit ensuite la consultation en base.
 */
export default function PaymentScreen() {
  const t = useT();
  // La demande est lue une seule fois : elle est consommée dès que le widget a répondu.
  const pending = useMemo(() => getPendingPaymentWidget(), []);

  const html = useMemo(() => {
    if (!pending) return null;
    try {
      return buildInlineCheckoutHtml(pending.config, pending.request);
    } catch {
      return null;
    }
  }, [pending]);

  const finish = (message: Parameters<typeof settlePaymentWidget>[0]) => {
    settlePaymentWidget(message);
    router.back();
  };

  // Ouverture sans demande en cours (lien direct, rechargement) : retour immédiat.
  useEffect(() => {
    if (!html) router.back();
  }, [html]);

  // Fermeture par un retour système / geste sans réponse du widget = annulation (sans effet si déjà réglé).
  const navigation = useNavigation();
  useEffect(() => navigation.addListener('beforeRemove', () => settlePaymentWidget({ kind: 'cancelled' })), [navigation]);

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => finish({ kind: 'cancelled' })} className="p-1 mr-2">
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">{t('Paiement')}</Text>
      </View>
      {html && pending ? (
        <WebView
          originWhitelist={['*']}
          source={{ html }}
          javaScriptEnabled
          onMessage={(event) => {
            const message = parseWidgetMessage(event.nativeEvent.data);
            if (message.kind !== 'ignore') finish(message);
          }}
          onShouldStartLoadWithRequest={(req) => {
            // Retour de la passerelle vers l'app (deep link) : l'issue vient du widget (onComplete).
            if (req.url.startsWith(pending.config.redirectUrl) || req.url.startsWith('visiodoc://')) return false;
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
