import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChevronLeft } from 'lucide-react-native';
import { colors } from '@/theme/colors';

const STORAGE_KEY = 'visiodoc.notifications';

type Prefs = {
  appointments: boolean;
  results: boolean;
  promotions: boolean;
};

const DEFAULT_PREFS: Prefs = { appointments: true, results: true, promotions: false };

const ITEMS: { key: keyof Prefs; label: string; desc: string }[] = [
  { key: 'appointments', label: 'Rappels de rendez-vous', desc: 'Avant chaque consultation programmée' },
  { key: 'results', label: 'Résultats & ordonnances', desc: 'Quand un document est ajouté à votre dossier' },
  { key: 'promotions', label: 'Promotions & nouveautés', desc: 'Offres et actualités VisioDoc' },
];

export default function NotificationsSettings() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        try {
          setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) });
        } catch {
          /* ignore */
        }
      }
    });
  }, []);

  const toggle = (key: keyof Prefs) => {
    setPrefs((p) => {
      const next = { ...p, [key]: !p[key] };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2">
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">Notifications</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 12 }}>
        <View className="bg-surface rounded-3xl border border-line overflow-hidden">
          {ITEMS.map((it, i) => (
            <View
              key={it.key}
              className={`flex-row items-center px-4 py-4 ${i < ITEMS.length - 1 ? 'border-b border-line' : ''}`}
            >
              <View className="flex-1 pr-3">
                <Text className="text-ink font-sans-semibold">{it.label}</Text>
                <Text className="font-sans text-xs text-muted mt-0.5">{it.desc}</Text>
              </View>
              <Switch
                value={prefs[it.key]}
                onValueChange={() => toggle(it.key)}
                trackColor={{ false: colors.line, true: colors.primary }}
                thumbColor={colors.white}
                ios_backgroundColor={colors.line}
              />
            </View>
          ))}
        </View>

        <Text className="font-sans text-xs text-muted mt-4 text-center">
          Vos préférences sont enregistrées sur cet appareil.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
