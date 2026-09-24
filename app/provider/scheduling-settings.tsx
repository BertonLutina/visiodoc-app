import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { Button, Card } from '@/components/ui';
import { AvailabilityTabs } from '@/components/AvailabilityTabs';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { currentProvider } from '@/data/mockProvider';
import { getSchedulingSettings, saveSchedulingSettings } from '@/services/providerApi';
import { DEFAULT_SETTINGS, type SchedulingSettings } from '@/services/availabilityEngine';

type FieldDef = {
  key: keyof SchedulingSettings;
  label: string;
  hint: string;
  options: number[];
  unit: string;
};

const FIELDS: FieldDef[] = [
  { key: 'appointmentDurationMinutes', label: 'Durée d\'un rendez-vous', hint: 'Temps réservé pour chaque consultation.', options: [15, 20, 30, 45, 60], unit: 'min' },
  { key: 'slotIntervalMinutes', label: 'Intervalle entre créneaux', hint: 'À quelle fréquence un nouveau créneau peut démarrer.', options: [10, 15, 20, 30, 60], unit: 'min' },
  { key: 'bufferBeforeMinutes', label: 'Tampon avant', hint: 'Temps de battement avant chaque rendez-vous.', options: [0, 5, 10, 15, 30], unit: 'min' },
  { key: 'bufferAfterMinutes', label: 'Tampon après', hint: 'Temps de battement après chaque rendez-vous.', options: [0, 5, 10, 15, 30], unit: 'min' },
  { key: 'minimumNoticeMinutes', label: 'Préavis minimum', hint: 'Délai minimum avant qu\'un patient puisse réserver.', options: [0, 30, 60, 120, 240, 1440], unit: 'min' },
  { key: 'bookingHorizonDays', label: 'Horizon de réservation', hint: 'Nombre de jours à l\'avance réservables.', options: [14, 30, 60, 90, 180], unit: 'jours' },
];

export default function SchedulingSettingsScreen() {
  const { user } = useAuth();
  const uid = user?.id ?? currentProvider.id;

  const [settings, setSettings] = useState<SchedulingSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    getSchedulingSettings(uid)
      .then((s) => active && setSettings(s))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [uid]);

  const onSave = async () => {
    setSaving(true);
    try {
      await saveSchedulingSettings(uid, settings);
      Alert.alert('Réglages enregistrés');
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? 'Impossible d\'enregistrer les réglages.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2">
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">Réglages de réservation</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 32 }}>
        <AvailabilityTabs active="settings" />

        {loading ? (
          <Text className="font-sans text-muted text-center mt-6">Chargement…</Text>
        ) : (
          <>
            {FIELDS.map((f) => (
              <Card key={f.key} className="mb-3">
                <Text className="font-sans-bold text-ink mb-1">{f.label}</Text>
                <Text className="font-sans text-xs text-muted mb-3">{f.hint}</Text>
                <View className="flex-row flex-wrap">
                  {f.options.map((opt) => {
                    const on = settings[f.key] === opt;
                    return (
                      <Pressable
                        key={opt}
                        onPress={() => setSettings((s) => ({ ...s, [f.key]: opt }))}
                        className={`px-4 py-2.5 rounded-2xl mr-2 mb-2 ${on ? 'bg-accent' : 'bg-bg border border-line'}`}
                      >
                        <Text className={`font-sans-bold text-sm ${on ? 'text-white' : 'text-ink'}`}>
                          {opt} {f.unit}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Card>
            ))}

            <Button label="Enregistrer les réglages" variant="accent" loading={saving} onPress={onSave} className="mt-2" />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
