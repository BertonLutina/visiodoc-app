import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus, Send, Clock, Smartphone, ArrowDownLeft, ArrowUpRight } from 'lucide-react-native';
import { Card, SectionTitle } from '@/components/ui';
import { formatMoney } from '@/utils/format';
import { colors } from '@/theme/colors';
import { activeCountry } from '@/config/countries';
import { wallet } from '@/data/mock';

// Moyens de paiement du pays actif (RDC : M-Pesa, Orange Money, Airtel Money)
const methods = activeCountry.paymentMethods.map((label, i) => ({
  icon: Smartphone,
  label,
  tag: i === 0 ? '✓' : '›',
}));

export default function WalletScreen() {
  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 24 }}>
        <Text className="font-serif-bold text-3xl text-ink mb-4" style={{ letterSpacing: -0.3 }}>
          Portefeuille
        </Text>

        {/* Solde */}
        <View className="rounded-[28px] bg-primary p-6 mb-4 overflow-hidden">
          <View
            className="absolute -right-8 -top-8 w-36 h-36 rounded-full"
            style={{ backgroundColor: '#15846A', opacity: 0.55 }}
          />
          <Text className="text-white/80 text-xs font-sans-bold">Solde disponible</Text>
          <Text className="text-white font-serif-bold mt-1" style={{ fontSize: 38 }}>
            {wallet.balance.toLocaleString('fr-FR')}
          </Text>
          <Text className="text-white/80 text-sm font-sans">
            {wallet.currency} · {wallet.countryLabel}
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
                <Text className="text-white text-xs font-sans-medium">{a.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Appels IA */}
        <Card className="mb-4 flex-row items-center justify-between">
          <View>
            <Text className="font-sans-medium text-sm text-muted">Appels IA restants</Text>
            <Text className="font-serif-bold text-3xl text-ink mt-0.5">{wallet.aiCreditsLeft}</Text>
          </View>
          <Pressable className="bg-primary-50 px-4 py-2.5 rounded-2xl">
            <Text className="text-primary font-sans-bold">Recharger</Text>
          </Pressable>
        </Card>

        {/* Méthodes */}
        <SectionTitle>Méthodes de paiement</SectionTitle>
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
        <SectionTitle>Transactions récentes</SectionTitle>
        {wallet.transactions.map((t) => {
          const credit = t.amount > 0;
          return (
            <Card key={t.id} className="mb-2 flex-row items-center">
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
                <Text className="font-sans-semibold text-ink">{t.label}</Text>
                <Text className="font-sans text-xs text-muted mt-0.5">{t.date}</Text>
              </View>
              <Text className={`font-sans-bold ${credit ? 'text-success' : 'text-danger'}`}>
                {credit ? '+' : ''}
                {formatMoney(t.amount)}
              </Text>
            </Card>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
