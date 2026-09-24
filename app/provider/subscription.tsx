import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Check } from 'lucide-react-native';
import { Button } from '@/components/ui';
import { colors } from '@/theme/colors';
import { activeCountry } from '@/config/countries';
import { subscriptionPlans } from '@/data/mockProvider';

const cur = activeCountry.currency.symbol;

export default function Subscription() {
  const [selected, setSelected] = useState(subscriptionPlans[0].id);

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2">
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">Abonnement</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 32 }}>
        <Text className="font-serif-bold text-3xl text-ink text-center" style={{ letterSpacing: -0.3 }}>
          Choisissez votre plan
        </Text>
        <Text className="font-sans text-sm text-muted text-center mb-6 mt-1">
          Accédez à toutes les fonctionnalités
        </Text>

        {subscriptionPlans.map((plan) => {
          const on = selected === plan.id;
          return (
            <Pressable
              key={plan.id}
              onPress={() => setSelected(plan.id)}
              className={`rounded-3xl border p-5 mb-4 ${on ? 'border-accent bg-accent-50' : 'border-line bg-surface'}`}
            >
              <View className="flex-row items-center justify-between mb-1">
                <Text className="font-serif-bold text-xl text-ink">{plan.name}</Text>
                {plan.hint ? (
                  <View className="bg-accent px-3 py-1 rounded-full">
                    <Text className="text-white text-xs font-sans-bold">{plan.hint}</Text>
                  </View>
                ) : null}
              </View>
              <Text className="font-serif-bold text-2xl text-ink mb-1">
                {plan.price.toLocaleString('fr-FR')} {cur} <Text className="font-sans text-sm text-muted">{plan.period}</Text>
              </Text>
              {plan.id === 'annual' && (
                <Text className="font-sans text-xs text-muted mb-2">= 7 492 {cur} / mois</Text>
              )}
              {plan.features.map((f) => (
                <View key={f} className="flex-row items-center py-1">
                  <Check color={colors.accent} size={16} />
                  <Text className="font-sans text-sm text-ink ml-2">{f}</Text>
                </View>
              ))}
            </Pressable>
          );
        })}

        <Button label="S'abonner maintenant" variant="accent" onPress={() => router.back()} className="mt-2" />
      </ScrollView>
    </SafeAreaView>
  );
}
