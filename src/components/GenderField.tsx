import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { genderLabel, type Gender } from '@/services/registration';
import { useT } from '@/i18n';

type Props = {
  value: Gender | null;
  onChange: (v: Gender) => void;
};

/** Sélecteur à deux choix (Masculin / Féminin → 'male' / 'female'). Aucun choix par défaut. */
export function GenderField({ value, onChange }: Props) {
  const t = useT();
  const options: { value: Gender; label: string }[] = [
    { value: 'male', label: genderLabel('male') },
    { value: 'female', label: genderLabel('female') },
  ];
  return (
    <View className="mb-4">
      <Text className="text-sm font-sans-semibold text-ink mb-2">{t('Genre')}</Text>
      <View className="flex-row gap-3">
        {options.map((o) => {
          const selected = value === o.value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              className={`flex-1 rounded-2xl py-3.5 items-center border ${
                selected ? 'bg-primary border-primary' : 'bg-surface border-line'
              }`}
            >
              <Text className={`font-sans-semibold text-base ${selected ? 'text-white' : 'text-ink'}`}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
