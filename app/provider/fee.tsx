import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { Button, Card, Field, SectionTitle } from '@/components/ui';
import { formatMoney, formatUsd } from '@/utils/format';
import { activeCountry } from '@/config/countries';
import { colors } from '@/theme/colors';
import { useAsync } from '@/hooks/useAsync';
import { getFeeConfig } from '@/services/providerApi';
import { feeConfig as mockFee } from '@/data/mockProvider';

export default function FeeScreen() {
  const { data } = useAsync(getFeeConfig, []);
  const feeConfig = data ?? mockFee;
  const [fee, setFee] = useState(String(mockFee.currentFee));
  const value = Number(fee) || 0;
  const platformFee = Math.round(value * feeConfig.platformFeeRate);
  const net = value - platformFee;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2">
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">Tarif consultation</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8 }}>
        <View className="rounded-[28px] bg-accent p-6 mb-5 overflow-hidden">
          <View
            className="absolute -right-8 -top-8 w-36 h-36 rounded-full"
            style={{ backgroundColor: '#F97316', opacity: 0.5 }}
          />
          <Text className="text-white/80 text-xs font-sans-bold">Tarif actuel</Text>
          <Text className="text-white font-serif-bold mt-1" style={{ fontSize: 38 }}>
            {feeConfig.currentFee.toLocaleString('fr-FR')}
          </Text>
          <Text className="text-white/80 text-sm font-sans">
            {activeCountry.currency.symbol} par consultation · {formatUsd(feeConfig.currentFee)}
          </Text>
        </View>

        <SectionTitle>Décomposition des frais</SectionTitle>
        <Card className="mb-5">
          <View className="flex-row justify-between py-1">
            <Text className="font-sans text-muted">Tarif brut</Text>
            <Text className="font-sans-semibold text-ink">{formatMoney(value)}</Text>
          </View>
          <View className="flex-row justify-between py-1">
            <Text className="font-sans text-muted">Frais plateforme ({feeConfig.platformFeeRate * 100}%)</Text>
            <Text className="font-sans-semibold text-danger">- {formatMoney(platformFee)}</Text>
          </View>
          <View className="h-px bg-line my-2" />
          <View className="flex-row justify-between items-end py-1">
            <Text className="font-sans-bold text-ink">Votre revenu net</Text>
            <View className="items-end">
              <Text className="font-serif-bold text-primary text-lg">{formatMoney(net)}</Text>
              <Text className="font-sans text-xs text-muted">{formatUsd(net)}</Text>
            </View>
          </View>
        </Card>

        <SectionTitle>Modifier le tarif</SectionTitle>
        <Field
          label={`Nouveau tarif (${activeCountry.currency.symbol})`}
          keyboardType="number-pad"
          value={fee}
          onChangeText={setFee}
        />
        <Button label="Enregistrer le tarif" variant="accent" onPress={() => router.back()} />

        <View className="bg-accent-50 rounded-2xl p-4 mt-5">
          <Text className="font-sans text-sm leading-5" style={{ color: '#9A3412' }}>
            ℹ Le tarif s'applique uniquement aux nouvelles consultations. Les RDV déjà confirmés ne sont pas affectés.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
