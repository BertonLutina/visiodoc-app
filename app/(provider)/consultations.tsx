import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, Badge, Card } from '@/components/ui';
import { colors } from '@/theme/colors';
import { typeLabel } from '@/utils/format';
import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { getProviderConsultations, getTodayConsultations, startConsultation } from '@/services/providerApi';
import { currentProvider } from '@/data/mockProvider';
import type { ProviderConsultation } from '@/types/provider';

type Tab = 'upcoming' | 'inprogress' | 'past';

function Row({ c, canStart }: { c: ProviderConsultation; canStart: boolean }) {
  return (
    <Card className="mb-3">
      <View className="flex-row items-center">
        <Avatar initials={c.patient.initials} size={42} tone="light" />
        <View className="flex-1 ml-3.5">
          <Text className="font-sans-bold text-ink">
            {c.patient.firstName} {c.patient.lastName}
          </Text>
          <Text className="font-sans text-xs text-muted mt-0.5">{c.reason}</Text>
        </View>
        <Badge label={c.status === 'pending' ? 'En attente' : 'Confirmée'} tone={c.status === 'pending' ? 'amber' : 'green'} />
      </View>
      <Text className="font-sans-semibold text-sm text-clay mt-3">
        {c.dateLabel} · {typeLabel(c.type)} · {c.durationMin} min
      </Text>
      {canStart && (
        <View className="flex-row mt-3">
          <Pressable
            onPress={async () => {
              await startConsultation(c.id);
              router.push(`/call/${c.roomId ?? c.id}`);
            }}
            className="flex-1 bg-accent rounded-2xl py-3.5 items-center mr-2"
          >
            <Text className="text-white font-sans-bold">Démarrer</Text>
          </Pressable>
          <Pressable className="flex-1 border border-line rounded-2xl py-3.5 items-center bg-surface">
            <Text className="text-ink font-sans-bold">Notes</Text>
          </Pressable>
        </View>
      )}
    </Card>
  );
}

export default function ProviderConsultations() {
  const { user } = useAuth();
  const uid = user?.id ?? currentProvider.id;
  const [tab, setTab] = useState<Tab>('upcoming');
  const tabs: { key: Tab; label: string }[] = [
    { key: 'upcoming', label: 'À venir' },
    { key: 'inprogress', label: 'En cours' },
    { key: 'past', label: 'Passées' },
  ];

  const upcomingReq = useAsync(
    () => getProviderConsultations(uid, ['pending_payment', 'scheduled']),
    [uid],
  );
  const inProgressReq = useAsync(() => getTodayConsultations(uid), [uid]);
  const pastReq = useAsync(
    () => getProviderConsultations(uid, ['completed', 'cancelled']),
    [uid],
  );

  const data =
    (tab === 'inprogress' ? inProgressReq.data : tab === 'past' ? pastReq.data : upcomingReq.data) ?? [];

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([upcomingReq.refresh(), inProgressReq.refresh(), pastReq.refresh()]);
    setRefreshing(false);
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="px-5 pt-2">
        <Text className="font-serif-bold text-3xl text-ink mb-4" style={{ letterSpacing: -0.3 }}>
          Mes consultations
        </Text>
        <View className="flex-row bg-surface border border-line rounded-2xl p-1">
          {tabs.map((t) => (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              className={`flex-1 py-2.5 rounded-xl items-center ${tab === t.key ? 'bg-accent' : ''}`}
            >
              <Text className={`text-sm font-sans-bold ${tab === t.key ? 'text-white' : 'text-muted'}`}>
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: 12 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />
        }
      >
        {data.map((c) => (
          <Row key={c.id} c={c} canStart={tab !== 'past'} />
        ))}
        {data.length === 0 && <Text className="text-center font-sans text-muted mt-10">Aucune consultation.</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}
