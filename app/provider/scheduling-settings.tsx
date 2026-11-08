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
import { useT } from '@/i18n';

type FieldDef = {
  key: keyof SchedulingSettings;
  label: string;
  hint: string;
  options: number[];
  unit: string;
};

const FIELDS: FieldDef[] = [
  { key: 'appointmentDurationMinutes', label: "Durée d'un rendez-vous", hint: 'Temps réservé pour chaque consultation.', options: [15, 20, 30, 45, 60], unit: 'min' },
  {
    key: 'slotIntervalMinutes',
    label: 'Intervalle entre créneaux',
    hint: '0 min enchaîne les créneaux sans écart. Les autres valeurs espacent le début de chaque créneau.',
    options: [0, 5, 10, 15, 20, 30, 45, 50, 60],
    unit: 'min',
  },
];

export default function SchedulingSettingsScreen() {
  const t = useT();
  const { user } = useAuth();
  const uid = user?.id ?? currentProvider.id;

  const [settings, setSettings] = useState<SchedulingSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    getSchedulingSettings(uid)
      .then((s) => active && setSettings(s))
      .catch((e: any) => active && setLoadError(e?.message ?? t('Impossible de charger les réglages.')))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [uid, retryNonce]);

  const onSave = async () => {
    setSaving(true);
    try {
      await saveSchedulingSettings(uid, {
        ...settings,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        minimumNoticeMinutes: 0,
      });
      Alert.alert(t('Réglages enregistrés'));
    } catch (e: any) {
      Alert.alert(t('Erreur'), e?.message ?? t("Impossible d'enregistrer les réglages."));
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
        <Text className="font-sans-bold text-lg text-ink">{t('Réglages de réservation')}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 32 }}>
        <AvailabilityTabs active="settings" />

        {loading ? (
          <Text className="font-sans text-muted text-center mt-6">{t('Chargement…')}</Text>
        ) : loadError ? (
          <View className="bg-sand rounded-2xl px-4 py-4 mt-2 items-center">
            <Text className="font-sans-medium text-sm text-clay text-center mb-3">{loadError}</Text>
            <Button label={t('Réessayer')} variant="outline" onPress={() => setRetryNonce((n) => n + 1)} />
          </View>
        ) : (
          <>
            {FIELDS.map((f) => (
              <Card key={f.key} className="mb-3">
                <Text className="font-sans-bold text-ink mb-1">{t(f.label)}</Text>
                <Text className="font-sans text-xs text-muted mb-3">{t(f.hint)}</Text>
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
                          {opt} {t(f.unit)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Card>
            ))}

            <Button label={t('Enregistrer les réglages')} variant="accent" loading={saving} onPress={onSave} className="mt-2" />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
