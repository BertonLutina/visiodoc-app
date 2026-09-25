import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search } from 'lucide-react-native';
import { Avatar, Card } from '@/components/ui';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { getPatients } from '@/services/providerApi';
import { currentProvider } from '@/data/mockProvider';

export default function ProviderPatients() {
  const { user } = useAuth();
  const uid = user?.id ?? currentProvider.id;
  const [query, setQuery] = useState('');
  const { data: patients, refreshing, refresh } = useAsync(() => getPatients(uid), [uid]);
  const list = (patients ?? []).filter((p) =>
    `${p.firstName} ${p.lastName} ${p.mainCondition}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="px-5 pt-2">
        <Text className="font-serif-bold text-3xl text-ink mb-4" style={{ letterSpacing: -0.3 }}>
          Mes patients
        </Text>
        <View className="flex-row items-center border border-line rounded-2xl px-4 py-1 bg-surface">
          <Search color={colors.muted} size={18} />
          <TextInput
            placeholder="Rechercher un patient..."
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
            className="flex-1 ml-2 py-3 text-base text-ink"
            style={{ fontFamily: 'Mulish_400Regular' }}
          />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: 12 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} />
        }
      >
        {list.map((p) => (
          <Pressable key={p.id} onPress={() => router.push(`/patient/${p.id}`)}>
            <Card className="mb-3 flex-row items-center">
              <Avatar initials={p.initials} size={44} tone="light" />
              <View className="flex-1 ml-3.5">
                <Text className="font-sans-bold text-ink">
                  {p.firstName} {p.lastName}
                </Text>
                <Text className="font-sans text-xs text-muted mt-0.5">
                  {p.age} ans · {p.gender}
                </Text>
                <Text className="font-sans text-xs text-clay mt-0.5">{p.mainCondition}</Text>
              </View>
              <View className="bg-accent-50 px-4 py-2.5 rounded-2xl">
                <Text className="text-accent font-sans-bold">Voir</Text>
              </View>
            </Card>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
