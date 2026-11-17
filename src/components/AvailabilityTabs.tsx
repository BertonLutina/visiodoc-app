import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useT } from '@/i18n';

const TABS = [
  { key: 'weekly', label: 'Hebdomadaire', href: '/provider/availability' },
  { key: 'overrides', label: 'Exceptions & Congés', href: '/provider/availability-overrides' },
  { key: 'settings', label: 'Réglages', href: '/provider/scheduling-settings' },
] as const;

export function AvailabilityTabs({ active }: { active: (typeof TABS)[number]['key'] }) {
  const translate = useT();
  return (
    <View className="flex-row bg-surface border border-line rounded-2xl p-1 mb-5">
      {TABS.map((t) => {
        const on = t.key === active;
        return (
          <Pressable
            key={t.key}
            onPress={() => {
              if (!on) router.replace(t.href as any);
            }}
            className={`flex-1 items-center py-2.5 rounded-xl ${on ? 'bg-accent' : ''}`}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              className={`font-sans-bold text-xs ${on ? 'text-white' : 'text-muted'}`}
            >
              {translate(t.label)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
