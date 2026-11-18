import React, { useEffect, useState } from 'react';
import { Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { MapPin } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { useT } from '@/i18n';
import { MAX_PLACE_LENGTH } from '@/utils/birthDate';
import {
  GEO_DEBOUNCE_MS,
  normalizeText,
  searchCities,
  searchCommunes,
  type CityItem,
  type CommuneItem,
} from '@/services/geo';

type Props = {
  city: string;
  commune: string;
  onCityChange: (v: string) => void;
  onCommuneChange: (v: string) => void;
  countryCode?: string;
  /** Anti-rebond de la saisie (ms) ; réglable pour les tests. */
  debounceMs?: number;
};

function useDebounced<T>(value: T, delay: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    if (delay <= 0) {
      setV(value);
      return;
    }
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  suggestions: { id: string; name: string }[];
  disabled?: boolean;
  hint?: string;
  testID: string;
};

/** Champ texte libre avec liste de propositions juste sous le champ (pas de modale). */
function SuggestField({ label, value, onChangeText, placeholder, suggestions, disabled, hint, testID }: FieldProps) {
  const [focused, setFocused] = useState(false);
  const q = normalizeText(value);
  // Rien à proposer si la saisie correspond déjà exactement à l'unique proposition.
  const visible = suggestions.filter((s) => normalizeText(s.name) !== q || suggestions.length > 1);
  const showList = focused && !disabled && visible.length > 0;

  return (
    <View className="mb-4">
      <Text className="text-sm font-sans-semibold text-ink mb-2">{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        editable={!disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        maxLength={MAX_PLACE_LENGTH}
        autoCorrect={false}
        autoCapitalize="words"
        className="rounded-2xl px-4 py-3.5 text-base text-ink bg-surface"
        style={{
          borderWidth: 1,
          borderColor: showList ? colors.primary : colors.line,
          fontFamily: 'Mulish_400Regular',
          opacity: disabled ? 0.5 : 1,
        }}
      />
      {disabled && hint ? <Text className="font-sans text-xs text-muted mt-1.5">{hint}</Text> : null}
      {showList ? (
        <View className="mt-2 rounded-2xl bg-surface overflow-hidden" style={{ borderWidth: 1, borderColor: colors.line }}>
          {visible.map((s, i) => (
            <Pressable
              key={s.id}
              testID={`${testID}-option-${i}`}
              onPress={() => {
                onChangeText(s.name);
                setFocused(false);
                Keyboard.dismiss();
              }}
              className={`flex-row items-center px-4 py-3 ${i < visible.length - 1 ? 'border-b border-line' : ''}`}
            >
              <MapPin color={colors.primary} size={16} />
              <Text className="flex-1 font-sans-medium text-ink ml-2" numberOfLines={1}>
                {s.name}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Ville + commune avec propositions (même contrat de données que le web : tables `cities` / `communes`).
 * La commune est liée à la ville : désactivée tant qu'aucune ville n'est saisie, filtrée sur la ville,
 * et vidée quand la ville change. La saisie libre reste toujours possible.
 */
export function CityCommuneFields({
  city,
  commune,
  onCityChange,
  onCommuneChange,
  countryCode = 'CD',
  debounceMs = GEO_DEBOUNCE_MS,
}: Props) {
  const t = useT();
  const [citySuggestions, setCitySuggestions] = useState<CityItem[]>([]);
  const [communeSuggestions, setCommuneSuggestions] = useState<CommuneItem[]>([]);
  const dCity = useDebounced(city, debounceMs);
  const dCommune = useDebounced(commune, debounceMs);

  useEffect(() => {
    let active = true;
    searchCities(dCity, countryCode)
      .then((r) => active && setCitySuggestions(r))
      .catch(() => active && setCitySuggestions([]));
    return () => {
      active = false;
    };
  }, [dCity, countryCode]);

  const hasCity = city.trim().length > 0;
  useEffect(() => {
    let active = true;
    if (!hasCity) {
      setCommuneSuggestions([]);
      return;
    }
    searchCommunes(dCity, dCommune, countryCode)
      .then((r) => active && setCommuneSuggestions(r))
      .catch(() => active && setCommuneSuggestions([]));
    return () => {
      active = false;
    };
  }, [hasCity, dCity, dCommune, countryCode]);

  const changeCity = (v: string) => {
    if (normalizeText(v) !== normalizeText(city)) onCommuneChange('');
    onCityChange(v);
  };

  return (
    <>
      <SuggestField
        testID="geo-city"
        label={t('Ville')}
        placeholder="Kinshasa"
        value={city}
        onChangeText={changeCity}
        suggestions={citySuggestions}
      />
      <SuggestField
        testID="geo-commune"
        label={t('Commune (facultatif)')}
        placeholder="Gombe"
        value={commune}
        onChangeText={onCommuneChange}
        suggestions={hasCity ? communeSuggestions : []}
        disabled={!hasCity}
        hint={t("Choisissez d'abord une ville.")}
      />
    </>
  );
}
