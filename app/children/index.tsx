import React, { useCallback } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Plus } from 'lucide-react-native';
import { Avatar, Button, Card } from '@/components/ui';
import { colors } from '@/theme/colors';
import { useAsync } from '@/hooks/useAsync';
import {
  calculateChildAge,
  getLatestChildMeasurements,
  listPatientChildren,
  measurementAgeText,
} from '@/services/childrenApi';
import { genderLabel } from '@/services/registration';
import type { ChildMeasurements, PatientChild } from '@/types/children';
import { useT } from '@/i18n';

type ChildRow = PatientChild & { measurements: ChildMeasurements | null };

async function loadChildren(): Promise<ChildRow[]> {
  const list = await listPatientChildren();
  return Promise.all(
    list.map(async (c) => ({ ...c, measurements: await getLatestChildMeasurements(c.id).catch(() => null) })),
  );
}

export default function MyChildren() {
  const t = useT();
  const { data, loading, error, refreshing, refresh, reload } = useAsync(loadChildren, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const list = data ?? [];

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center justify-between px-5 pt-2 pb-2">
        <View className="flex-row items-center">
          <Pressable onPress={() => router.back()} className="p-1 mr-2">
            <ChevronLeft color={colors.ink} size={26} />
          </Pressable>
          <Text className="font-sans-bold text-lg text-ink">{t('Mes enfants')}</Text>
        </View>
        <Pressable
          onPress={() => router.push('/children/add')}
          className="flex-row items-center bg-primary px-3.5 py-2 rounded-2xl"
        >
          <Plus color={colors.white} size={16} />
          <Text className="font-sans-bold text-white text-sm ml-1">{t('Ajouter')}</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {error ? (
          <View className="bg-sand rounded-2xl px-4 py-4 items-center mb-4">
            <Text className="font-sans-medium text-sm text-clay text-center mb-3">{t('Erreur de chargement. Réessayez.')}</Text>
            <Button label={t('Réessayer')} variant="outline" onPress={reload} />
          </View>
        ) : null}

        {!loading && !error && list.length === 0 ? (
          <View className="bg-surface border border-line rounded-3xl p-6 items-center">
            <Text className="font-sans-semibold text-ink text-center mb-3">{t("Aucun enfant enregistré pour l'instant.")}</Text>
            <Button label={t('Ajouter un enfant')} onPress={() => router.push('/children/add')} />
          </View>
        ) : null}

        {list.map((c) => {
          const age = calculateChildAge(c.dateOfBirth);
          const m = c.measurements;
          return (
            <Pressable key={c.id} onPress={() => router.push(`/children/${c.id}`)}>
            <Card className="mb-3">
              <View className="flex-row items-center">
                <Avatar initials={`${c.firstName.charAt(0)}${c.lastName.charAt(0)}`.toUpperCase() || '?'} size={44} tone="light" />
                <View className="flex-1 ml-3.5">
                  <Text className="font-sans-bold text-ink">
                    {c.firstName} {c.lastName}
                  </Text>
                  <Text className="font-sans text-xs text-muted mt-0.5">
                    {age !== null ? `${age} ${t('ans')}` : t('Âge inconnu')} · {genderLabel(c.gender)}
                  </Text>
                </View>
              </View>
              <Text className="font-sans text-sm text-muted mt-3">
                {m?.weightKg != null ? `${m.weightKg} kg` : t('Poids inconnu')}
                {' · '}
                {m?.heightCm != null ? `${m.heightCm} cm` : t('Taille inconnue')}
                {m?.measuredAt ? ` (${measurementAgeText(m.measuredAt)})` : ''}
              </Text>
            </Card>
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
