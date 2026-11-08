import React, { useEffect, useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { ChevronLeft } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { useT } from '@/i18n';
import { buildInlineCheckoutHtml, isAllowedWidgetUrl, parseWidgetMessage } from '@/utils/paymentForm';
import { getPendingPaymentWidget, settlePaymentWidget } from '@/services/paymentWidget';
import type { WidgetMessage } from '@/utils/paymentForm';

/**
 * Exécute le widget de paiement dans une WebView et rapporte l'issue (succès + payRef, annulation, erreur)
 * à la promesse `openPaymentWidget` de la demande `txnRef`. Cet écran ne confirme rien et n'écrit rien :
 * `confirm-consultation-payment` est appelé par l'appelant, qui relit ensuite la consultation en base.
 */
export default function PaymentScreen() {
  const t = useT();
  const { txnRef } = useLocalSearchParams<{ txnRef?: string }>();
  // La demande est lue une seule fois : elle est consommée dès que le widget a répondu.
  const pending = useMemo(() => getPendingPaymentWidget(txnRef), [txnRef]);

  const html = useMemo(() => {
    if (!pending) return null;
    try {
      return buildInlineCheckoutHtml(pending.config, pending.request);
    } catch {
      return null;
    }
  }, [pending]);

  const finish = (message: WidgetMessage) => {
    if (txnRef) settlePaymentWidget(txnRef, message);
    router.back();
  };

  // Ouverture sans demande en cours (lien direct, rechargement) : retour immédiat.
  useEffect(() => {
    if (!html) router.back();
  }, [html]);

  // Fermeture par un retour système / geste sans réponse du widget = annulation (sans effet si déjà réglé).
  const navigation = useNavigation();
  useEffect(
    () =>
      navigation.addListener('beforeRemove', () => {
        if (txnRef) settlePaymentWidget(txnRef, { kind: 'cancelled' });
      }),
    [navigation, txnRef],
  );

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
          // Liste blanche : about:blank + hôtes de la passerelle (https). Non vérifié sur appareil.
          originWhitelist={['https://*', 'about:blank']}
          source={{ html }}
          javaScriptEnabled
          // Le widget Interswitch peut s'appuyer sur sessionStorage / localStorage ; popups interdites
          // (tout reste dans cette WebView, donc sous la liste blanche). Non vérifié sur appareil.
          domStorageEnabled
          setSupportMultipleWindows={false}
          onMessage={(event) => {
            // Seul un résultat portant EXACTEMENT la `txnRef` de cette demande est pris en compte.
            const message = parseWidgetMessage(event.nativeEvent.data, pending.request.txnRef);
            if (message.kind !== 'ignore') finish(message);
          }}
          onShouldStartLoadWithRequest={(req) => isAllowedWidgetUrl(req.url, pending.config)}
        />
      ) : (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="font-sans text-muted text-center">{t('Paiement indisponible.')}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}
