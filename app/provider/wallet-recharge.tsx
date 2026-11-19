import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Coins } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { useT } from '@/i18n';
import { useAuth } from '@/contexts/AuthContext';
import { MobileMoneyModal } from '@/components/MobileMoneyModal';
import {
  computeWalletRechargeTotal,
  getMyWalletRechargePrice,
  type WalletRechargePrice,
} from '@/services/mobileMoney';

const QUANTITIES: readonly (5 | 10 | 20 | 50 | 100)[] = [5, 10, 20, 50, 100];

export default function WalletRechargeScreen() {
  const t = useT();
  const { user } = useAuth();
  const [price, setPrice] = useState<WalletRechargePrice | null>(null);
  const [loading, setLoading] = useState(true);
  const [quantity, setQuantity] = useState<5 | 10 | 20 | 50 | 100>(10);
  const [showMobileMoney, setShowMobileMoney] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMyWalletRechargePrice()
      .then((res) => {
        if (!cancelled) setPrice(res);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const payCurrency: 'USD' | 'CDF' = price?.priceCurrency === 'USD' ? 'USD' : 'CDF';
  const total = price
    ? computeWalletRechargeTotal(price.unitPrice, quantity, price.priceCurrency, payCurrency)
    : null;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2" accessibilityRole="button" accessibilityLabel={t('Retour')}>
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">{t("Recharger mes appels IA")}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20 }}>
        {loading ? (
          <ActivityIndicator color={colors.accent} className="mt-8" />
        ) : !price ? (
          <Text className="font-sans text-sm text-muted text-center mt-8">
            {t("Le tarif de recharge n'est pas disponible pour le moment.")}
          </Text>
        ) : (
          <>
            <View className="bg-white rounded-2xl p-4 border border-slate-200 mb-5">
              <View className="flex-row items-center mb-1">
                <Coins color={colors.accent} size={18} />
                <Text className="font-sans-bold text-sm text-ink ml-2">
                  {t("Tarif unitaire par appel")}
                </Text>
              </View>
              <Text className="font-sans-bold text-xl text-emerald-700">
                {price.unitPrice.toLocaleString('fr-FR')} {price.priceCurrency}
              </Text>
            </View>

            <Text className="font-sans-semibold text-sm text-ink mb-3">
              {t("Choisis un forfait d'appels")}
            </Text>
            <View className="flex-row flex-wrap gap-2.5 mb-6">
              {QUANTITIES.map((q) => {
                const selected = quantity === q;
                return (
                  <Pressable
                    key={q}
                    onPress={() => setQuantity(q)}
                    className={`px-4 py-3 rounded-xl border ${
                      selected ? 'bg-emerald-50 border-emerald-600' : 'bg-white border-slate-200'
                    }`}
                  >
                    <Text className={`font-sans-bold text-sm ${selected ? 'text-emerald-800' : 'text-ink'}`}>
                      {q} {t('appels')}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {total && 'amount' in total ? (
              <Pressable
                onPress={() => setShowMobileMoney(true)}
                className="bg-emerald-600 rounded-xl py-3.5 items-center"
              >
                <Text className="font-sans-bold text-base text-white">
                  {t('Payer')} {total.amount.toLocaleString('fr-FR')} {total.currency}
                </Text>
              </Pressable>
            ) : total && 'error' in total ? (
              <Text className="font-sans text-sm text-red-700 text-center">{total.error}</Text>
            ) : null}
          </>
        )}
      </ScrollView>

      <MobileMoneyModal
        visible={showMobileMoney}
        target={{ kind: 'wallet_recharge', quantity, currency: payCurrency }}
        userPhone={user?.phone}
        amountLabel={
          total && 'amount' in total
            ? `${total.amount.toLocaleString('fr-FR')} ${total.currency}`
            : undefined
        }
        onClose={() => setShowMobileMoney(false)}
        onPaid={() => {
          setShowMobileMoney(false);
          Alert.alert(t('Paiement confirmé'), t('Tes appels IA ont été crédités.'));
          router.back();
        }}
      />
    </SafeAreaView>
  );
}
