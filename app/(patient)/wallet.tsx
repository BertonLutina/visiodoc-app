import React, { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus, Send, Clock, Smartphone, ArrowDownLeft, ArrowUpRight } from 'lucide-react-native';
import { Card, SectionTitle } from '@/components/ui';
import { formatMoney } from '@/utils/format';
import { colors } from '@/theme/colors';
import { getCountry } from '@/config/countries';
import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { getWallet } from '@/services/patientApi';
import { appLocale, useT } from '@/i18n';

export default function WalletScreen() {
  const t = useT();
  const { user } = useAuth();
  const country = getCountry(user?.countryCode ?? 'CD');
  const uid = user?.id ?? '';
  const { data: wallet, loading, error, refresh, refreshing } = useAsync(() => getWallet(uid), [uid]);
  const transactions = wallet?.transactions ?? [];

  const [pulling, setPulling] = useState(false);
  const onRefresh = async () => {
    setPulling(true);
    await refresh();
    setPulling(false);
  };

  // Moyens de paiement du pays du patient (RDC : M-Pesa, Orange Money, Airtel Money)
  const methods = country.paymentMethods.map((label, i) => ({
    icon: Smartphone,
    label,
    tag: i === 0 ? '✓' : '›',
  }));

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 24 }}
        refreshControl={
          <RefreshControl
            refreshing={pulling || refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <Text className="font-serif-bold text-3xl text-ink mb-4" style={{ letterSpacing: -0.3 }}>
          {t('Portefeuille')}
        </Text>

        {/* Total des paiements réussis */}
        <View className="rounded-[28px] bg-primary p-6 mb-4 overflow-hidden">
          <View
            className="absolute -right-8 -top-8 w-36 h-36 rounded-full"
            style={{ backgroundColor: '#15846A', opacity: 0.55 }}
          />
          <Text className="text-white/80 text-xs font-sans-bold">{t('Total payé')}</Text>
          {loading ? (
            <ActivityIndicator color={colors.white} style={{ marginTop: 16, marginBottom: 8 }} />
          ) : (
            <Text className="text-white font-serif-bold mt-1" style={{ fontSize: 38 }}>
              {(wallet?.balance ?? 0).toLocaleString(appLocale())}
            </Text>
          )}
          <Text className="text-white/80 text-sm font-sans">
            {country.currency.symbol} · {country.name}
          </Text>
          <View className="flex-row justify-between mt-6">
            {[
              { icon: Plus, label: 'Recharger' },
              { icon: Send, label: 'Envoyer' },
              { icon: Clock, label: 'Historique' },
            ].map((a) => (
              <Pressable key={a.label} className="items-center flex-1">
                <View className="w-12 h-12 rounded-full bg-white/20 items-center justify-center mb-1.5">
                  <a.icon color={colors.white} size={20} />
                </View>
                <Text className="text-white text-xs font-sans-medium">{t(a.label)}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Méthodes */}
        <SectionTitle>{t('Méthodes de paiement')}</SectionTitle>
        {methods.map((m) => (
          <Card key={m.label} className="mb-2 flex-row items-center">
            <View className="w-10 h-10 rounded-2xl bg-primary-50 items-center justify-center mr-3">
              <m.icon color={colors.primary} size={18} />
            </View>
            <Text className="flex-1 font-sans-semibold text-ink">{m.label}</Text>
            <Text className="text-primary text-lg">{m.tag}</Text>
          </Card>
        ))}

        {/* Transactions */}
        <SectionTitle>{t('Transactions récentes')}</SectionTitle>
        {error ? (
          <Text className="font-sans text-sm text-clay mb-3">{error}</Text>
        ) : null}
        {loading && transactions.length === 0 ? (
          <Text className="text-center text-muted mt-6">{t('Chargement…')}</Text>
        ) : null}
        {!loading && transactions.length === 0 ? (
          <Text className="text-center text-muted mt-6">{t('Aucune transaction pour le moment.')}</Text>
        ) : null}
        {transactions.map((tx) => {
          const credit = tx.amount > 0;
          return (
            <Card key={tx.id} className="mb-2 flex-row items-center">
              <View
                className="w-9 h-9 rounded-full items-center justify-center mr-3"
                style={{ backgroundColor: credit ? colors.primaryLight : '#FEE2E2' }}
              >
                {credit ? (
                  <ArrowDownLeft color={colors.success} size={18} />
                ) : (
                  <ArrowUpRight color={colors.danger} size={18} />
                )}
              </View>
              <View className="flex-1">
                <Text className="font-sans-semibold text-ink">
                  {t(tx.label)}
                  {tx.method ? ` · Dr. ${tx.method}` : ''}
                </Text>
                <Text className="font-sans text-xs text-muted mt-0.5">{tx.date}</Text>
              </View>
              <Text className={`font-sans-bold ${credit ? 'text-success' : 'text-danger'}`}>
                {credit ? '+' : ''}
                {formatMoney(tx.amount, country)}
              </Text>
            </Card>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
