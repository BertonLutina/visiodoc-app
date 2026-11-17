import React from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  User as UserIcon,
  FileText,
  Wallet,
  Bell,
  HelpCircle,
  LogOut,
  ChevronRight,
} from 'lucide-react-native';
import { AvatarPicker } from '@/components/AvatarPicker';
import { colors } from '@/theme/colors';
import { getCountry } from '@/config/countries';
import { useAuth } from '@/contexts/AuthContext';
import { BiometricToggleRow } from '@/components/BiometricToggleRow';
import { PreferencesSection } from '@/components/PreferencesSection';
import { LegalAccountSection } from '@/components/LegalAccountSection';
import { useT } from '@/i18n';

const initialsOf = (a?: string, b?: string) =>
  `${(a ?? '').charAt(0)}${(b ?? '').charAt(0)}`.toUpperCase() || 'VD';

type Row = {
  icon: typeof UserIcon;
  label: string;
  onPress?: () => void;
};

export default function PatientProfile() {
  const t = useT();
  const { user, logout } = useAuth();
  const country = getCountry(user?.countryCode ?? 'CD');
  const fullName = user ? `${user.firstName} ${user.lastName}`.trim() : t('Mon compte');

  const actions: Row[] = [
    { icon: UserIcon, label: 'Modifier le profil', onPress: () => router.push('/profile-edit') },
    { icon: FileText, label: 'Dossier médical', onPress: () => router.push('/records') },
    { icon: Wallet, label: 'Portefeuille', onPress: () => router.push('/(patient)/wallet') },
    { icon: Bell, label: 'Notifications', onPress: () => router.push('/notifications') },
    {
      icon: HelpCircle,
      label: 'Aide & Support',
      onPress: () => Linking.openURL('mailto:support@visiodoc.app?subject=Aide%20VisioDoc'),
    },
  ];

  const onLogout = async () => {
    await logout();
    router.replace('/(auth)/login');
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 24 }}>
        <View className="items-center mb-7">
          <AvatarPicker initials={initialsOf(user?.firstName, user?.lastName)} size={76} />
          <Text className="font-serif-bold text-2xl text-ink mt-3">{fullName}</Text>
          <Text className="font-sans text-sm text-muted mt-0.5">
            {t('Patient')} · {country.capital}, {country.name}
          </Text>
          {user?.email ? (
            <Text className="font-sans text-xs text-muted mt-0.5">{user.email}</Text>
          ) : null}
        </View>

        {/* Actions */}
        <View className="bg-surface rounded-3xl border border-line overflow-hidden mb-4">
          {actions.map((r, i) => (
            <Pressable
              key={r.label}
              onPress={r.onPress}
              className={`flex-row items-center px-4 py-4 ${i < actions.length - 1 ? 'border-b border-line' : ''}`}
            >
              <View className="w-10 h-10 rounded-2xl bg-primary-50 items-center justify-center mr-3">
                <r.icon color={colors.primary} size={18} />
              </View>
              <Text className="flex-1 text-ink font-sans-semibold">{t(r.label)}</Text>
              <ChevronRight color={colors.muted} size={18} />
            </Pressable>
          ))}
        </View>

        <PreferencesSection />

        <BiometricToggleRow />

        <LegalAccountSection />

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
