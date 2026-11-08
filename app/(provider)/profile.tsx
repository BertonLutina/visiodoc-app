import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  User as UserIcon,
  Stethoscope,
  CalendarClock,
  Star,
  Brain,
  Bell,
  LogOut,
  ChevronRight,
} from 'lucide-react-native';
import { AvatarPicker } from '@/components/AvatarPicker';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { BiometricToggleRow } from '@/components/BiometricToggleRow';
import { PreferencesSection } from '@/components/PreferencesSection';
import { providerGate } from '@/services/accessPolicy';
import { useAsync } from '@/hooks/useAsync';
import { useFocusEffect } from 'expo-router';
import { getMySpecializations } from '@/services/providerApi';
import { joinSpecializations } from '@/services/specializations';
import { useT } from '@/i18n';

export default function ProviderProfile() {
  const t = useT();
  const { user, logout } = useAuth();
  // Seules les données réelles du compte s'affichent ici : aucun tarif, plan ou horaire inventé par le client.
  const fullAccess = !!user && providerGate(user.doctorStatus, user.isActive) === 'full';
  const { data: specs, refresh: refreshSpecs } = useAsync(() => getMySpecializations(user?.id ?? ''), [user?.id]);
  useFocusEffect(
    React.useCallback(() => {
      refreshSpecs();
    }, [user?.id]),
  );
  const specLabel = specs && specs.length ? joinSpecializations(specs) : undefined;

  const displayName = user
    ? `Dr. ${user.firstName} ${user.lastName}`.trim()
    : 'Dr.';
  const initials = user
    ? `${(user.firstName ?? '').charAt(0)}${(user.lastName ?? '').charAt(0)}`.toUpperCase() || 'DR'
    : 'DR';

  const rows = [
    { icon: UserIcon, label: 'Mon profil', value: 'Infos personnelles', onPress: () => router.push('/profile-edit') },
    { icon: Stethoscope, label: 'Spécialisation', value: specLabel, onPress: () => router.push('/provider/specializations') },
    { icon: CalendarClock, label: 'Disponibilités', onPress: () => router.push('/provider/availability') },
    {
      icon: Star,
      label: 'Abonnement',
      value: fullAccess ? 'Abonnement actif' : undefined,
      onPress: () => router.push('/provider/subscription'),
    },
    { icon: Brain, label: 'Analyse IA', value: 'Bientôt disponible', disabled: true },
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
          <AvatarPicker initials={initials} size={76} tone="clay" />
          <Text className="font-serif-bold text-2xl text-ink mt-3">{displayName}</Text>
          <Text className="font-sans text-sm text-muted mt-0.5">
            {t('Médecin')}
          </Text>
          {fullAccess ? (
            <View className="bg-accent-50 px-3 py-1.5 rounded-full mt-3">
              <Text className="font-sans-bold text-xs" style={{ color: '#9A3412' }}>{t('✓ Compte validé · Actif')}</Text>
            </View>
          ) : null}
        </View>

        <View className="bg-surface rounded-3xl border border-line overflow-hidden">
          {rows.map((r, i) => (
            <Pressable
              key={r.label}
              onPress={r.onPress}
              disabled={r.disabled}
              className={`flex-row items-center px-4 py-4 ${r.disabled ? 'opacity-50' : ''} ${i < rows.length - 1 ? 'border-b border-line' : ''}`}
            >
              <View className="w-10 h-10 rounded-2xl bg-accent-50 items-center justify-center mr-3">
                <r.icon color={colors.accent} size={18} />
              </View>
              <View className="flex-1">
                <Text className="text-ink font-sans-semibold">{t(r.label)}</Text>
                {r.value ? <Text className="font-sans text-xs text-muted mt-0.5">{t(r.value)}</Text> : null}
              </View>
              {r.disabled ? null : <ChevronRight color={colors.muted} size={18} />}
            </Pressable>
          ))}
        </View>

        <PreferencesSection tone="accent" />

        <BiometricToggleRow tone="accent" />

        <Pressable
          onPress={onLogout}
          className="flex-row items-center justify-center mt-5 py-4 rounded-2xl border border-line bg-surface"
        >
          <LogOut color={colors.danger} size={18} />
          <Text className="text-danger font-sans-bold ml-2">{t('Se déconnecter')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
