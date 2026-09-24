import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search } from 'lucide-react-native';
import { DoctorCard } from '@/components/DoctorCard';
import { colors } from '@/theme/colors';
import { useAsync } from '@/hooks/useAsync';
import { getDoctors } from '@/services/patientApi';

const filters = ['Tous', 'Généraliste', 'Pédiatrie', 'Cardio', 'Gynéco'];

export default function DoctorsSearch() {
  const [active, setActive] = useState('Tous');
  const [query, setQuery] = useState('');
  const { data: doctors, loading, refreshing, refresh } = useAsync(getDoctors, []);

  const list = useMemo(() => {
    return (doctors ?? []).filter((d) => {
      const matchFilter =
        active === 'Tous' || d.specialty.toLowerCase().includes(active.toLowerCase().slice(0, 5));
      const matchQuery =
        !query ||
        `${d.firstName} ${d.lastName} ${d.specialty} ${d.city}`.toLowerCase().includes(query.toLowerCase());
      return matchFilter && matchQuery;
    });
  }, [active, query, doctors]);

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="px-5 pt-2 pb-2">
        <Text className="font-serif-bold text-3xl text-ink mb-4" style={{ letterSpacing: -0.3 }}>
          Trouver un médecin
        </Text>
        <View className="flex-row items-center border border-line rounded-2xl px-4 py-1 bg-surface mb-4">
          <Search color={colors.muted} size={18} />
          <TextInput
            placeholder="Spécialité, nom, ville..."
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
            className="flex-1 ml-2 py-3 text-base text-ink"
            style={{ fontFamily: 'Mulish_400Regular' }}
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {filters.map((f) => {
            const on = f === active;
            return (
              <Pressable
                key={f}
                onPress={() => setActive(f)}
                className={`px-4 py-2 rounded-full mr-2 ${on ? 'bg-primary' : 'bg-surface border border-line'}`}
              >
                <Text className={`text-sm font-sans-semibold ${on ? 'text-white' : 'text-muted'}`}>{f}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: 12 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {list.map((d) => (
          <DoctorCard key={d.id} doctor={d} onPress={() => router.push(`/doctor/${d.id}`)} />
        ))}
        {loading && <Text className="text-center text-muted mt-10">Chargement…</Text>}
        {!loading && list.length === 0 && (
          <Text className="text-center text-muted mt-10">Aucun médecin trouvé.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
