import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronDown, Search, X, Check } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { useT } from '@/i18n';
import { filterByPrefix } from '@/services/geo';
import { toE164 } from '@/utils/phone';
import {
  DEFAULT_DIAL_COUNTRY_CODE,
  DIAL_COUNTRIES,
  getDialCountry,
  splitE164,
  type DialCountry,
} from '@/data/dialCodes';

type Props = {
  label?: string;
  /** Valeur initiale (E.164 `+32475123456` ou saisie libre) ; le composant garde ensuite son propre état. */
  initialValue?: string;
  /** Reçoit le numéro au format E.164 (`''` si la saisie est vide ou sans chiffre utile). */
  onChange: (e164: string) => void;
  /** Indicatif par défaut (code ISO du pays) ; RDC si omis. */
  defaultDialCountry?: string;
  hint?: string;
  testID?: string;
};

/**
 * Téléphone : indicatif mondial (indépendant du Visiodoc du compte) + numéro.
 * Un numéro saisi avec `+` ou `00` garde son propre indicatif (voir `toE164`).
 */
export function PhoneField({ label, initialValue, onChange, defaultDialCountry, hint, testID }: Props) {
  const t = useT();
  const initial = useMemo(() => {
    const split = initialValue ? splitE164(initialValue) : null;
    if (split) return { country: split.country, local: split.national };
    return {
      country: getDialCountry(defaultDialCountry ?? DEFAULT_DIAL_COUNTRY_CODE) ?? DIAL_COUNTRIES[0],
      local: initialValue ?? '',
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [dial, setDial] = useState<DialCountry>(initial.country);
  const [local, setLocal] = useState(initial.local);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const emit = (nextLocal: string, nextDial: DialCountry) => onChange(toE164(nextLocal, nextDial.dialCode) ?? '');
  const list = useMemo(() => filterByPrefix(DIAL_COUNTRIES, query, DIAL_COUNTRIES.length), [query]);
  const full = toE164(local, dial.dialCode);

  const choose = (c: DialCountry) => {
    setDial(c);
    setOpen(false);
    setQuery('');
    emit(local, c);
  };

  return (
    <View className="mb-4" testID={testID}>
      {label ? <Text className="text-sm font-sans-semibold text-ink mb-2">{label}</Text> : null}
      <View className="flex-row items-center">
        <Pressable
          testID="phone-dial-button"
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t('Indicatif : {name}. Appuyez pour changer.', { name: `${dial.name} ${dial.dialCode}` })}
          className="flex-row items-center rounded-2xl px-3 py-3.5 bg-surface mr-2"
          style={{ borderWidth: 1, borderColor: colors.line }}
        >
          <Text className="text-xl mr-2">{dial.flag}</Text>
          <Text className="text-base text-ink font-sans-medium mr-1">{dial.dialCode}</Text>
          <ChevronDown color={colors.muted} size={18} />
        </Pressable>
        <TextInput
          testID="phone-local-input"
          placeholder="81 234 5678"
          placeholderTextColor={colors.muted}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          autoCorrect={false}
          value={local}
          onChangeText={(v) => {
            setLocal(v);
            emit(v, dial);
          }}
          className="flex-1 rounded-2xl px-4 py-3.5 text-base text-ink bg-surface"
          style={{ borderWidth: 1, borderColor: colors.line, fontFamily: 'Mulish_400Regular' }}
        />
      </View>
      {hint ? (
        <Text className="font-sans text-xs text-muted mt-1.5">{hint}</Text>
      ) : full ? (
        <Text className="font-sans text-xs text-muted mt-1.5">{t('Sera envoyé au {phone}', { phone: full })}</Text>
      ) : null}

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
          <View className="flex-row items-center justify-between px-5 pt-2 pb-3">
            <Text className="font-serif-bold text-2xl text-ink">{t('Choisir un indicatif')}</Text>
            <Pressable onPress={() => setOpen(false)} hitSlop={10} className="p-1">
              <X color={colors.ink} size={24} />
            </Pressable>
          </View>
          <View className="px-5 pb-2">
            <View
              className="flex-row items-center rounded-2xl px-4 bg-surface"
              style={{ borderWidth: 1, borderColor: colors.line }}
            >
              <Search color={colors.muted} size={18} />
              <TextInput
                testID="phone-dial-search"
                placeholder={t('Rechercher un pays…')}
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
            ListEmptyComponent={<Text className="text-center font-sans text-muted mt-10">{t('Aucun pays trouvé.')}</Text>}
            renderItem={({ item }) => (
              <Pressable
                testID={`dial-${item.code}`}
                onPress={() => choose(item)}
                className="flex-row items-center py-3.5 border-b border-line"
              >
                <Text className="text-2xl mr-3">{item.flag}</Text>
                <Text className="flex-1 text-base text-ink font-sans-medium">{item.name}</Text>
                <Text className="font-sans text-sm text-muted mr-3">{item.dialCode}</Text>
                {item.code === dial.code ? <Check color={colors.primary} size={20} strokeWidth={3} /> : null}
              </Pressable>
            )}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}
