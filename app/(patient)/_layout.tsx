import React from 'react';
import { Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { Home, Stethoscope, Calendar, Wallet, User } from 'lucide-react-native';
import { GlassTabBar } from '@/components/GlassTabBar';
import { colors } from '@/theme/colors';
import { useT } from '@/i18n';

/**
 * iOS  → NativeTabs (UITabBar natif, Liquid Glass sur iOS 26).
 * Android / web → tab bar custom « glass » (rendu maîtrisé, identique).
 */
export default function PatientTabsLayout() {
  const t = useT();
  if (Platform.OS === 'ios') {
    return (
      <NativeTabs tintColor={colors.primary}>
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Label>{t('Accueil')}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="house.fill" />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="doctors">
          <NativeTabs.Trigger.Label>{t('Prestataires')}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="stethoscope" />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="appointments">
          <NativeTabs.Trigger.Label>{t('RDV')}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="calendar" />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="wallet">
          <NativeTabs.Trigger.Label>{t('Wallet')}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="creditcard.fill" />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="profile">
          <NativeTabs.Trigger.Label>{t('Profil')}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="person.fill" />
        </NativeTabs.Trigger>
      </NativeTabs>
    );
  }

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <GlassTabBar {...props} tint={colors.primary} />}
    >
      <Tabs.Screen name="index" options={{ title: 'Accueil', tabBarIcon: ({ color, size }) => <Home color={color} size={size} /> }} />
      <Tabs.Screen name="doctors" options={{ title: 'Prestataires', tabBarIcon: ({ color, size }) => <Stethoscope color={color} size={size} /> }} />
      <Tabs.Screen name="appointments" options={{ title: 'RDV', tabBarIcon: ({ color, size }) => <Calendar color={color} size={size} /> }} />
      <Tabs.Screen name="wallet" options={{ title: 'Wallet', tabBarIcon: ({ color, size }) => <Wallet color={color} size={size} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profil', tabBarIcon: ({ color, size }) => <User color={color} size={size} /> }} />
    </Tabs>
  );
}
