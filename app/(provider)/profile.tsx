import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  User as UserIcon,
  Stethoscope,
  Coins,
  CalendarClock,
  Star,
  Brain,
  Bell,
  LogOut,
  ChevronRight,
} from 'lucide-react-native';
import { Avatar } from '@/components/ui';
import { formatMoney } from '@/utils/format';
import { colors } from '@/theme/colors';
import { activeCountry } from '@/config/countries';
import { useAuth } from '@/contexts/AuthContext';
import { BiometricToggleRow } from '@/components/BiometricToggleRow';
import { currentProvider } from '@/data/mockProvider';

export default function ProviderProfile() {
  const { user, logout } = useAuth();
  const p = currentProvider;

  const displayName = user
    ? `Dr. ${user.firstName} ${user.lastName}`.trim()
    : `Dr. ${p.firstName} ${p.lastName}`;
  const initials = user
    ? `${(user.firstName ?? '').charAt(0)}${(user.lastName ?? '').charAt(0)}`.toUpperCase() || 'DR'
    : p.initials;

  const rows = [
    { icon: UserIcon, label: 'Mon profil', value: 'Infos personnelles', onPress: () => router.push('/profile-edit') },
    { icon: Stethoscope, label: 'Spécialisations', value: p.specialization, onPress: () => {} },
    { icon: Coins, label: 'Tarif consultation', value: `${formatMoney(p.consultationFee)} / consult.`, onPress: () => router.push('/provider/fee') },
    { icon: CalendarClock, label: 'Disponibilités', value: 'Lun–Ven · 9h–18h', onPress: () => router.push('/provider/availability') },
    { icon: Star, label: 'Abonnement', value: 'Plan annuel · Actif', onPress: () => router.push('/provider/subscription') },
    { icon: Brain, label: 'Analyse IA', value: '8 crédits disponibles', onPress: () => {} },
    { icon: Bell, label: 'Notifications', onPress: () => router.push('/notifications') },
  ];

  const onLogout = async () => {
    await logout();
    router.replace('/(auth)/login-provider');
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 24 }}>
        <View className="items-center mb-7">
          <Avatar initials={initials} size={76} tone="clay" />
          <Text className="font-serif-bold text-2xl text-ink mt-3">{displayName}</Text>
          <Text className="font-sans text-sm text-muted mt-0.5">
            Médecin · {p.city}, {activeCountry.name}
          </Text>
          <View className="bg-accent-50 px-3 py-1.5 rounded-full mt-3">
            <Text className="font-sans-bold text-xs" style={{ color: '#9A3412' }}>✓ Compte validé · Actif</Text>
          </View>
        </View>

        <View className="bg-surface rounded-3xl border border-line overflow-hidden">
          {rows.map((r, i) => (
            <Pressable
              key={r.label}
              onPress={r.onPress}
              className={`flex-row items-center px-4 py-4 ${i < rows.length - 1 ? 'border-b border-line' : ''}`}
            >
              <View className="w-10 h-10 rounded-2xl bg-accent-50 items-center justify-center mr-3">
                <r.icon color={colors.accent} size={18} />
              </View>
              <View className="flex-1">
                <Text className="text-ink font-sans-semibold">{r.label}</Text>
                {r.value ? <Text className="font-sans text-xs text-muted mt-0.5">{r.value}</Text> : null}
              </View>
              <ChevronRight color={colors.muted} size={18} />
            </Pressable>
          ))}
        </View>

        <BiometricToggleRow tone="accent" />

        <Pressable
          onPress={onLogout}
          className="flex-row items-center justify-center mt-5 py-4 rounded-2xl border border-line bg-surface"
        >
          <LogOut color={colors.danger} size={18} />
          <Text className="text-danger font-sans-bold ml-2">Se déconnecter</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
