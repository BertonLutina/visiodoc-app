import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search } from 'lucide-react-native';
import { Avatar, Card } from '@/components/ui';
import { colors } from '@/theme/colors';
import { providerPatientFiles } from '@/data/mockProvider';

export default function ProviderRecords() {
  const [query, setQuery] = useState('');
  const list = providerPatientFiles.filter((p) =>
    `${p.firstName} ${p.lastName}`.toLowerCase().includes(query.toLowerCase()),
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
        {list.map((p) => (
          <Card key={p.patientId} className="mb-3 flex-row items-center">
            <Avatar initials={p.initials} size={44} tone="light" />
            <View className="flex-1 ml-3.5">
              <Text className="font-sans-bold text-ink">
                {p.firstName} {p.lastName}
              </Text>
              <Text className="font-sans text-xs text-muted mt-0.5">{p.lastActLabel}</Text>
            </View>
            <Pressable className="border border-line px-4 py-2.5 rounded-2xl bg-surface">
              <Text className="text-accent font-sans-bold">Modifier</Text>
            </Pressable>
          </Card>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
