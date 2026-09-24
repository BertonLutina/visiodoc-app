import React, { useMemo, useState } from 'react';
import { Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { Check, Plus } from 'lucide-react-native';
import { colors } from '@/theme/colors';

// Normalise : sans accents, minuscule, sans espaces superflus
const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

type Props = {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  options: string[];
  placeholder?: string;
  /** Nombre max de suggestions affichées */
  limit?: number;
};

export function Autocomplete({
  label,
  value,
  onChangeText,
  options,
  placeholder,
  limit = 8,
}: Props) {
  const [focused, setFocused] = useState(false);

  const q = norm(value);
  const exactMatch = useMemo(() => options.some((o) => norm(o) === q), [options, q]);

  const suggestions = useMemo(() => {
    if (!q) return options.slice(0, limit);
    const starts = options.filter((o) => norm(o).startsWith(q));
    const contains = options.filter((o) => !norm(o).startsWith(q) && norm(o).includes(q));
    return [...starts, ...contains].slice(0, limit);
  }, [options, q, limit]);

  const choose = (s: string) => {
    onChangeText(s);
    setFocused(false);
    Keyboard.dismiss();
  };

  const showList = focused && (suggestions.length > 0 || (!!value && !exactMatch));

  return (
    <View className="mb-4">
      {label ? <Text className="text-sm font-sans-semibold text-ink mb-2">{label}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        autoCorrect={false}
        className="rounded-2xl px-4 py-3.5 text-base text-ink bg-surface"
        style={{
          borderWidth: 1,
          borderColor: showList ? colors.primary : colors.line,
          fontFamily: 'Mulish_400Regular',
        }}
      />

      {showList ? (
        <View
          className="mt-2 rounded-2xl bg-surface overflow-hidden"
          style={{ borderWidth: 1, borderColor: colors.line }}
        >
          {/* Saisie libre si aucune correspondance exacte */}
          {!!value && !exactMatch ? (
            <Pressable
              onPress={() => choose(value)}
              className="flex-row items-center px-4 py-3 border-b border-line"
            >
              <Plus color={colors.primary} size={16} />
              <Text className="font-sans-semibold text-primary ml-2" numberOfLines={1}>
                Utiliser « {value} »
              </Text>
            </Pressable>
          ) : null}

          {suggestions.map((s, i) => {
            const active = norm(s) === q;
            return (
              <Pressable
                key={s}
                onPress={() => choose(s)}
                className={`flex-row items-center px-4 py-3 ${i < suggestions.length - 1 ? 'border-b border-line' : ''}`}
              >
                <Text className="flex-1 font-sans-medium text-ink" numberOfLines={1}>
                  {s}
                </Text>
                {active ? <Check color={colors.primary} size={18} strokeWidth={3} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
