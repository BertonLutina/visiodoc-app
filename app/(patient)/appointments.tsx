import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, Badge, Button, Card } from '@/components/ui';
import { colors } from '@/theme/colors';
import { formatMoney, typeLabel } from '@/utils/format';
import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { getPastConsultations, getUpcomingConsultations } from '@/services/patientApi';
import type { Consultation, ConsultationStatus } from '@/types';

const statusBadge: Record<ConsultationStatus, { label: string; tone: 'green' | 'amber' | 'slate' }> = {
  confirmed: { label: 'Confirmée', tone: 'green' },
  pending: { label: 'En attente', tone: 'amber' },
  in_progress: { label: 'En cours', tone: 'green' },
  completed: { label: 'Terminée', tone: 'slate' },
  cancelled: { label: 'Annulée', tone: 'slate' },
};

function Row({ c, joinable }: { c: Consultation; joinable: boolean }) {
  const sb = statusBadge[c.status];
  return (
    <Card className="mb-3">
      <View className="flex-row items-center">
        <Avatar initials={c.doctor.initials} size={44} tone="light" />
        <View className="flex-1 ml-3.5">
          <Text className="font-sans-bold text-ink">
            Dr. {c.doctor.firstName} {c.doctor.lastName}
          </Text>
          <Text className="font-sans text-xs text-muted mt-0.5">{c.doctor.specialty}</Text>
        </View>
        <Badge label={sb.label} tone={sb.tone} />
      </View>
      <Text className="font-sans-semibold text-sm text-clay mt-3">{c.dateLabel}</Text>
      <Text className="font-sans text-sm text-muted mt-0.5">
        {typeLabel(c.type)} · {c.durationMin} min · {formatMoney(c.fee)}
      </Text>
      {joinable && c.status !== 'pending' && (
        <Button
          label="Rejoindre la consultation"
          className="mt-3"
          onPress={() => router.push(`/call/${c.roomId ?? c.id}`)}
        />
      )}
    </Card>
  );
}

export default function Appointments() {
  const { user } = useAuth();
  const uid = user?.id ?? 'patient-1';
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const up = useAsync(() => getUpcomingConsultations(uid), [uid]);
  const pastReq = useAsync(() => getPastConsultations(uid), [uid]);
  const data = (tab === 'upcoming' ? up.data : pastReq.data) ?? [];

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([up.refresh(), pastReq.refresh()]);
    setRefreshing(false);
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="px-5 pt-2">
        <Text className="font-serif-bold text-3xl text-ink mb-4" style={{ letterSpacing: -0.3 }}>
          Mes consultations
        </Text>
        <View className="flex-row bg-surface border border-line rounded-2xl p-1 mb-2">
          {(['upcoming', 'past'] as const).map((t) => (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              className={`flex-1 py-2.5 rounded-xl items-center ${tab === t ? 'bg-primary' : ''}`}
            >
              <Text className={`font-sans-bold ${tab === t ? 'text-white' : 'text-muted'}`}>
                {t === 'upcoming' ? 'À venir' : 'Passées'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: 12 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {data.map((c) => (
          <Row key={c.id} c={c} joinable={tab === 'upcoming'} />
        ))}
        {data.length === 0 && (
          <Text className="text-center font-sans text-muted mt-10">
            {tab === 'upcoming' ? 'Aucune consultation à venir.' : 'Aucune consultation passée.'}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
