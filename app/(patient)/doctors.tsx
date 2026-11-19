import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search } from 'lucide-react-native';
import { DoctorCard } from '@/components/DoctorCard';
import { colors } from '@/theme/colors';
import { getCountry } from '@/config/countries';
import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { SignInForPricing } from '@/components/SignInForPricing';
import { getDoctors, shouldHideCommercialInfo } from '@/services/patientApi';
import { useT } from '@/i18n';

const filters = ['Tous', 'Généraliste', 'Pédiatrie', 'Cardio', 'Gynéco'];

export default function DoctorsSearch() {
  const t = useT();
  const { user } = useAuth();
  const country = getCountry(user?.countryCode ?? 'CD');
  const [active, setActive] = useState('Tous');
  const [query, setQuery] = useState('');
  const [childrenOnly, setChildrenOnly] = useState(false);
  const signedIn = !!user;
  const { data: doctors, loading, refreshing, refresh } = useAsync(
    () => getDoctors({ signedIn, acceptsChildren: childrenOnly }),
    [signedIn, childrenOnly],
  );

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
          {t('Trouver un médecin')}
        </Text>
        <View className="flex-row items-center border border-line rounded-2xl px-4 py-1 bg-surface mb-4">
          <Search color={colors.muted} size={18} />
          <TextInput
            placeholder={t('Spécialité, nom, ville...')}
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
            className="flex-1 ml-2 py-3 text-base text-ink"
            style={{ fontFamily: 'Mulish_400Regular' }}
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Pressable
            onPress={() => setChildrenOnly((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: childrenOnly }}
            className={`px-4 py-2 rounded-full mr-2 ${childrenOnly ? 'bg-primary' : 'bg-surface border border-line'}`}
          >
            <Text className={`text-sm font-sans-semibold ${childrenOnly ? 'text-white' : 'text-muted'}`}>
              {t('Consultations pour enfants')}
            </Text>
          </Pressable>
          {filters.map((f) => {
            const on = f === active;
            return (
              <Pressable
                key={f}
                onPress={() => setActive(f)}
                className={`px-4 py-2 rounded-full mr-2 ${on ? 'bg-primary' : 'bg-surface border border-line'}`}
              >
                <Text className={`text-sm font-sans-semibold ${on ? 'text-white' : 'text-muted'}`}>{t(f)}</Text>
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
        {!loading && list.some((d) => shouldHideCommercialInfo(d.fee, signedIn)) && (
          <SignInForPricing signedIn={signedIn} className="mb-3" />
        )}
        {list.map((d) => (
          <DoctorCard
            key={d.id}
            doctor={d}
            country={country}
            signedIn={signedIn}
            onPress={() => router.push(`/doctor/${d.id}`)}
          />
        ))}
        {loading && <Text className="text-center text-muted mt-10">{t('Chargement…')}</Text>}
        {!loading && list.length === 0 && (
          <Text className="text-center text-muted mt-10">{t('Aucun médecin trouvé.')}</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
