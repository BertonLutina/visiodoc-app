import React from 'react';
import { Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { Home, Users, CalendarClock, FolderHeart, User } from 'lucide-react-native';
import { GlassTabBar } from '@/components/GlassTabBar';
import { colors } from '@/theme/colors';

/**
 * Espace médecin (accent orange).
 * iOS → NativeTabs (Liquid Glass iOS 26) ; Android / web → tab bar custom « glass ».
 */
export default function ProviderTabsLayout() {
  if (Platform.OS === 'ios') {
    return (
      <NativeTabs tintColor={colors.accent}>
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Label>Accueil</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="house.fill" />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="patients">
          <NativeTabs.Trigger.Label>Patients</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="person.2.fill" />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="consultations">
          <NativeTabs.Trigger.Label>Consult.</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="calendar.badge.clock" />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="records">
          <NativeTabs.Trigger.Label>Dossiers</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="folder.fill" />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="profile">
          <NativeTabs.Trigger.Label>Profil</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="person.crop.circle" />
        </NativeTabs.Trigger>
      </NativeTabs>
    );
  }

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <GlassTabBar {...props} tint={colors.accent} />}
    >
      <Tabs.Screen name="index" options={{ title: 'Accueil', tabBarIcon: ({ color, size }) => <Home color={color} size={size} /> }} />
      <Tabs.Screen name="patients" options={{ title: 'Patients', tabBarIcon: ({ color, size }) => <Users color={color} size={size} /> }} />
      <Tabs.Screen name="consultations" options={{ title: 'Consult.', tabBarIcon: ({ color, size }) => <CalendarClock color={color} size={size} /> }} />
      <Tabs.Screen name="records" options={{ title: 'Dossiers', tabBarIcon: ({ color, size }) => <FolderHeart color={color} size={size} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profil', tabBarIcon: ({ color, size }) => <User color={color} size={size} /> }} />
    </Tabs>
  );
}
