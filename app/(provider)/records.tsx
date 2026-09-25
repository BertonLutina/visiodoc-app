import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search } from 'lucide-react-native';
import { Avatar, Card } from '@/components/ui';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { getPatients, getLatestRecordByPatient } from '@/services/providerApi';
import { RECORD_KIND_META } from '@/services/medicalRecordTaxonomy';
import { currentProvider } from '@/data/mockProvider';

export default function ProviderRecords() {
  const { user } = useAuth();
  const doctorId = user?.id ?? currentProvider.id;
  const [query, setQuery] = useState('');

  const { data: patients } = useAsync(() => getPatients(doctorId), [doctorId]);
  const { data: latestByPatient } = useAsync(() => getLatestRecordByPatient(doctorId), [doctorId]);

  const list = useMemo(
    () => (patients ?? []).filter((p) => `${p.firstName} ${p.lastName}`.toLowerCase().includes(query.toLowerCase())),
    [patients, query],
  );

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="px-5 pt-2">
        <Text className="font-serif-bold text-3xl text-ink mb-4" style={{ letterSpacing: -0.3 }}>
          Dossiers médicaux
        </Text>
        <View className="flex-row items-center border border-line rounded-2xl px-4 py-1 bg-surface">
          <Search color={colors.muted} size={18} />
          <TextInput
            placeholder="Rechercher un dossier..."
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
            className="flex-1 ml-2 py-3 text-base text-ink"
            style={{ fontFamily: 'Mulish_400Regular' }}
          />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 12 }}>
        {list.map((p) => {
          const last = latestByPatient?.get(p.id);
          const lastLabel = last ? `${RECORD_KIND_META[last.kind].label} · ${last.date}` : 'Aucun dossier pour le moment';
          return (
            <Pressable key={p.id} onPress={() => router.push(`/patient/${p.id}`)}>
              <Card className="mb-3 flex-row items-center">
                <Avatar initials={p.initials} size={44} tone="light" />
                <View className="flex-1 ml-3.5">
                  <Text className="font-sans-bold text-ink">
                    {p.firstName} {p.lastName}
                  </Text>
                  <Text className="font-sans text-xs text-muted mt-0.5">{lastLabel}</Text>
                </View>
              </Card>
            </Pressable>
          );
        })}
        {list.length === 0 ? (
          <View className="bg-surface border border-line rounded-3xl p-6 items-center">
            <Text className="font-sans-semibold text-ink text-center">Aucun patient pour le moment</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
