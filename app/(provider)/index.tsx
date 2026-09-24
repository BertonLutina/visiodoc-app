import React, { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme/colors';
import { activeCountry } from '@/config/countries';
import { Avatar, Badge, Card, SectionTitle, Stars } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { getDashboardStats, getTodayConsultations } from '@/services/providerApi';
import { currentProvider, providerReviews, providerStats } from '@/data/mockProvider';

export default function ProviderDashboard() {
  const { user } = useAuth();
  const uid = user?.id ?? currentProvider.id;
  const statsReq = useAsync(() => getDashboardStats(uid), [uid]);
  const todayReq = useAsync(() => getTodayConsultations(uid), [uid]);
  const s = statsReq.data ?? providerStats;
  const providerTodayConsultations = todayReq.data ?? [];

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([statsReq.refresh(), todayReq.refresh()]);
    setRefreshing(false);
  };

  const displayName = user
    ? `Dr. ${user.firstName} ${user.lastName}`.trim()
    : `Dr. ${currentProvider.firstName} ${currentProvider.lastName}`;
  const initials = user
    ? `${(user.firstName ?? '').charAt(0)}${(user.lastName ?? '').charAt(0)}`.toUpperCase() || 'DR'
    : currentProvider.initials;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />
        }
      >
        {/* Greeting */}
        <View className="flex-row items-center justify-between px-5 pt-3 pb-4">
          <View className="flex-1 pr-3">
            <Text className="font-sans-medium text-sm text-muted">Bonjour,</Text>
            <Text className="font-serif-bold text-2xl text-ink mt-0.5">{displayName}</Text>
          </View>
          <Avatar initials={initials} tone="clay" />
        </View>

        <View className="px-5 mb-5">
          <View className="bg-accent-50 rounded-2xl px-4 py-3 flex-row items-center">
            <Text className="font-sans-bold text-sm" style={{ color: '#9A3412' }}>
              ✓ Compte validé · Abonnement actif
            </Text>
          </View>
        </View>

        {/* Stats */}
        <View className="px-5 flex-row flex-wrap justify-between mb-2">
          <Card className="w-[48%] mb-3">
            <Text className="font-serif-bold text-3xl text-ink">{s.patientsTotal}</Text>
            <Text className="font-sans-semibold text-sm text-ink mt-1">Patients total</Text>
            <Text className="font-sans text-xs text-success">ce mois +{s.patientsNew}</Text>
          </Card>
          <Card className="w-[48%] mb-3">
            <Text className="font-serif-bold text-3xl text-ink">{s.consultationsThisMonth}</Text>
            <Text className="font-sans-semibold text-sm text-ink mt-1">Consult./mois</Text>
            <Text className="font-sans text-xs text-success">{s.consultationsTrend}</Text>
          </Card>
          <Card className="w-[48%]">
            <Text className="font-serif-bold text-3xl text-ink">{Math.round(s.netRevenue / 1000)}k {activeCountry.currency.symbol}</Text>
            <Text className="font-sans-semibold text-sm text-ink mt-1">Revenu net</Text>
            <Text className="font-sans text-xs text-muted">ce mois</Text>
          </Card>
          <Card className="w-[48%]">
            <Text className="font-serif-bold text-3xl text-ink">{s.averageRating}</Text>
            <Text className="font-sans-semibold text-sm text-ink mt-1">Note moyenne</Text>
            <Text className="font-sans text-xs text-muted">sur 5 ⭐</Text>
          </Card>
        </View>

        {/* Consultations aujourd'hui */}
        <View className="px-5">
          <SectionTitle>Consultations aujourd'hui</SectionTitle>
          {providerTodayConsultations.map((c) => (
            <Card key={c.id} className="mb-3 flex-row items-center">
              <Avatar initials={c.patient.initials} size={42} tone="light" />
              <View className="flex-1 ml-3.5">
                <Text className="font-sans-bold text-ink">
                  {c.patient.firstName} {c.patient.lastName}
                </Text>
                <Text className="font-sans text-xs text-clay mt-0.5">
                  {c.dateLabel} · {c.type === 'video' ? 'Vidéo' : c.type === 'phone' ? 'Téléphone' : 'Chat'}
                </Text>
              </View>
              <Badge label="Confirmée" tone="green" />
            </Card>
          ))}
        </View>

        {/* Avis récents */}
        <View className="px-5">
          <SectionTitle>Avis récents</SectionTitle>
          {providerReviews.map((r) => (
            <Card key={r.id} className="mb-3">
              <Stars rating={r.rating} />
              <Text className="font-serif text-ink text-base mt-2 leading-6">"{r.comment}"</Text>
              <Text className="font-sans text-xs text-muted mt-2">
                {r.author} · {r.date}
              </Text>
            </Card>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
