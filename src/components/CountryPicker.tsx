import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronDown, Search, X, Check } from 'lucide-react-native';
import { AFRICAN_COUNTRIES, getAfricanCountry, type AfricanCountry } from '@/config/africanCountries';
import { colors } from '@/theme/colors';

type Props = {
  label?: string;
  /** ISO code du pays sélectionné, ex: 'CD' */
  value: string;
  onSelect: (country: AfricanCountry) => void;
};

export function CountryPicker({ label, value, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = getAfricanCountry(value) ?? AFRICAN_COUNTRIES[0];

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return AFRICAN_COUNTRIES;
    return AFRICAN_COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dialCode.includes(q) ||
        c.code.toLowerCase().includes(q),
    );
  }, [query]);

  const choose = (c: AfricanCountry) => {
    onSelect(c);
    setOpen(false);
    setQuery('');
  };

  return (
    <View className="mb-4">
      {label ? <Text className="text-sm font-sans-semibold text-ink mb-2">{label}</Text> : null}
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Pays : ${selected.name}. Appuyez pour changer.`}
        className="flex-row items-center rounded-2xl px-4 py-3.5 bg-surface"
        style={{ borderWidth: 1, borderColor: colors.line }}
      >
        <Text className="text-xl mr-3">{selected.flag}</Text>
        <Text className="flex-1 text-base text-ink font-sans-medium">{selected.name}</Text>
        <ChevronDown color={colors.muted} size={20} />
      </Pressable>

      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
          {/* Header */}
          <View className="flex-row items-center justify-between px-5 pt-2 pb-3">
            <Text className="font-serif-bold text-2xl text-ink">Choisir un pays</Text>
            <Pressable onPress={() => setOpen(false)} hitSlop={10} className="p-1">
              <X color={colors.ink} size={24} />
            </Pressable>
          </View>

          {/* Recherche */}
          <View className="px-5 pb-2">
            <View
              className="flex-row items-center rounded-2xl px-4 bg-surface"
              style={{ borderWidth: 1, borderColor: colors.line }}
            >
              <Search color={colors.muted} size={18} />
              <TextInput
                placeholder="Rechercher un pays…"
                placeholderTextColor={colors.muted}
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
                className="flex-1 ml-2 py-3 text-base text-ink"
                style={{ fontFamily: 'Mulish_400Regular' }}
              />
            </View>
          </View>

          <FlatList
            data={list}
            keyExtractor={(c) => c.code}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
            ListEmptyComponent={
              <Text className="text-center font-sans text-muted mt-10">Aucun pays trouvé.</Text>
            }
            renderItem={({ item }) => {
              const active = item.code === selected.code;
              return (
                <Pressable
                  onPress={() => choose(item)}
                  className="flex-row items-center py-3.5 border-b border-line"
                >
                  <Text className="text-2xl mr-3">{item.flag}</Text>
                  <Text className="flex-1 text-base text-ink font-sans-medium">{item.name}</Text>
                  <Text className="font-sans text-sm text-muted mr-3">{item.dialCode}</Text>
                  {active ? <Check color={colors.primary} size={20} strokeWidth={3} /> : null}
                </Pressable>
              );
            }}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}
