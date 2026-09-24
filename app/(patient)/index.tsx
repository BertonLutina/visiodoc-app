import React, { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stethoscope, FolderHeart, Wallet, Calendar, Video, CalendarPlus } from 'lucide-react-native';
import { Avatar, Badge, Card, Eyebrow } from '@/components/ui';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { getUpcomingConsultations, getPastConsultations } from '@/services/patientApi';

const quick = [
  { icon: Stethoscope, label: 'Médecin', href: '/(patient)/doctors' as const, tint: 'bg-sage' },
  { icon: FolderHeart, label: 'Dossiers', href: '/records' as const, tint: 'bg-peach' },
  { icon: Wallet, label: 'Wallet', href: '/(patient)/wallet' as const, tint: 'bg-sand' },
  { icon: Calendar, label: 'RDV', href: '/(patient)/appointments' as const, tint: 'bg-lavender' },
];

export default function PatientDashboard() {
  const { user } = useAuth();
  const uid = user?.id ?? 'patient-1';
  const up = useAsync(() => getUpcomingConsultations(uid), [uid]);
  const pastReq = useAsync(() => getPastConsultations(uid), [uid]);
  const { data: upcoming, loading: upLoading } = up;
  const { data: past } = pastReq;

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([up.refresh(), pastReq.refresh()]);
    setRefreshing(false);
  };

  const upList = upcoming ?? [];
  const pastList = past ?? [];
  const next = upList[0];

  const fullName = user ? `${user.firstName} ${user.lastName}`.trim() : 'Bienvenue';
  const initials =
    `${(user?.firstName ?? '').charAt(0)}${(user?.lastName ?? '').charAt(0)}`.toUpperCase() || 'VD';

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {/* Greeting */}
        <View className="flex-row items-center justify-between px-5 pt-3 pb-5">
          <View className="flex-1 pr-3">
            <Text className="font-sans-medium text-sm text-muted">Bonjour,</Text>
            <Text className="font-serif-bold text-2xl text-ink mt-0.5">{fullName}</Text>
          </View>
          <Avatar initials={initials} />
        </View>

        {/* Prochaine consultation */}
        <View className="px-5 mb-5">
          {upLoading ? (
            <View className="rounded-[28px] bg-primary p-6 items-center justify-center" style={{ minHeight: 160 }}>
              <ActivityIndicator color={colors.white} />
            </View>
          ) : next ? (
            <View className="rounded-[28px] bg-primary p-6 overflow-hidden">
              <View
                className="absolute -right-8 -top-8 w-36 h-36 rounded-full"
                style={{ backgroundColor: '#15846A', opacity: 0.55 }}
              />
              <Eyebrow className="bg-white/20 mb-3">
                <Text className="font-sans-bold text-white text-xs">Prochaine consultation</Text>
              </Eyebrow>
              <Text className="font-serif-bold text-white text-2xl">
                Dr. {next.doctor.firstName} {next.doctor.lastName}
              </Text>
              <Text className="font-sans text-white/80 text-sm mt-1 mb-5">{next.dateLabel} · Vidéo</Text>
              <Pressable
                onPress={() => router.push(`/call/${next.roomId ?? next.id}`)}
                className="bg-white rounded-2xl py-3.5 flex-row items-center justify-center"
              >
                <Video color={colors.primary} size={18} />
                <Text className="font-sans-bold text-primary text-base ml-2">Rejoindre</Text>
              </Pressable>
            </View>
          ) : (
            <View className="rounded-[28px] bg-surface border border-line p-6 items-center">
              <View className="w-12 h-12 rounded-2xl bg-primary-50 items-center justify-center mb-3">
                <CalendarPlus color={colors.primary} size={24} />
              </View>
              <Text className="font-serif-bold text-ink text-lg">Aucune consultation à venir</Text>
              <Text className="font-sans text-sm text-muted mt-1 mb-4 text-center">
                Trouvez un médecin et prenez rendez-vous en quelques minutes.
              </Text>
              <Pressable
                onPress={() => router.push('/(patient)/doctors')}
                className="bg-primary rounded-2xl py-3.5 px-6 w-full items-center"
              >
                <Text className="font-sans-bold text-white text-base">Prendre rendez-vous</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Stats */}
        <View className="px-5 flex-row justify-between mb-5">
          <Card className="w-[48%]">
            <Text className="font-serif-bold text-4xl text-ink">{pastList.length}</Text>
            <Text className="font-sans-semibold text-sm text-ink mt-1">Consultations</Text>
            <Text className="font-sans text-xs text-muted">au total</Text>
          </Card>
          <Card className="w-[48%]">
            <Text className="font-serif-bold text-4xl text-ink">{upList.length}</Text>
            <Text className="font-sans-semibold text-sm text-ink mt-1">À venir</Text>
            <Text className="font-sans text-xs text-muted">consultations</Text>
          </Card>
        </View>

        {/* Accès rapides */}
        <View className="px-5">
          <Text className="font-sans-bold text-ink text-lg mb-3">Accès rapides</Text>
          <View className="flex-row justify-between mb-6">
            {quick.map((q) => (
              <Pressable key={q.label} onPress={() => router.push(q.href)} className="items-center w-[23%]">
                <View className={`w-16 h-16 rounded-3xl items-center justify-center mb-2 ${q.tint}`}>
                  <q.icon color={colors.ink} size={24} />
                </View>
                <Text className="font-sans-medium text-xs text-ink">{q.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Récentes */}
        <View className="px-5">
          <Text className="font-sans-bold text-ink text-lg mb-3">Récentes</Text>
          {pastList.length === 0 ? (
            <Card>
              <Text className="font-sans text-sm text-muted text-center py-2">
                Aucune consultation récente.
              </Text>
            </Card>
          ) : (
            pastList.map((c) => (
              <Card key={c.id} className="mb-3 flex-row items-center">
                <Avatar initials={c.doctor.initials} size={44} tone="light" />
                <View className="flex-1 ml-3.5">
                  <Text className="font-sans-bold text-ink">
                    Dr. {c.doctor.firstName} {c.doctor.lastName}
                  </Text>
                  <Text className="font-sans text-xs text-muted mt-0.5">{c.doctor.specialty}</Text>
                  <Text className="font-sans text-xs text-clay mt-1">
                    {c.dateLabel} · {c.durationMin} min
                  </Text>
                </View>
                <Badge label="Terminée" tone="slate" />
              </Card>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
