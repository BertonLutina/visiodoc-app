import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, ChevronLeft, Plus, X } from 'lucide-react-native';
import { Button } from '@/components/ui';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { getMySpecializations, saveMySpecializations } from '@/services/providerApi';
import { dedupeSpecializations } from '@/services/specializations';
import {
  getApprovedSpecializations,
  specKey,
  suggestSpecializations,
} from '@/services/specializationCatalog';
import { SPECIALIZATIONS } from '@/config/specializations';
import { authErrorMessage } from '@/utils/authError';
import { useT } from '@/i18n';

const norm = specKey;

export default function SpecializationsScreen() {
  const t = useT();
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const { data, loading } = useAsync(() => getMySpecializations(userId), [userId]);
  const { data: catalogData } = useAsync(getApprovedSpecializations, []);
  const catalog = catalogData ?? SPECIALIZATIONS;
  const catalogKeys = useMemo(() => new Set(catalog.map(norm)), [catalog]);
  // « En attente » : hors liste officielle (proposé, pas encore accepté par l'administrateur).
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (data) setSelected(data);
  }, [data]);

  const q = norm(query);
  const results = useMemo(() => {
    const list = q ? catalog.filter((s) => norm(s).includes(q)) : catalog;
    return list.slice(0, 40);
  }, [q, catalog]);
  const isSelected = (s: string) => selected.some((x) => norm(x) === norm(s));
  const exact = catalogKeys.has(q);

  const toggle = (s: string) => {
    setErrorMsg(null);
    const value = s.trim();
    if (!value) return;
    if (isSelected(value)) setSelected([]);
    else setSelected(dedupeSpecializations([value]));
  };

  const onSave = async () => {
    setSaving(true);
    setErrorMsg(null);
    try {
      const saved = await saveMySpecializations(userId, selected);
      await suggestSpecializations(userId, saved, catalog);
      router.back();
    } catch (e: any) {
      setErrorMsg(e?.userFacing ? e.message : authErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2">
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">{t('Spécialisation')}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8 }} keyboardShouldPersistTaps="handled">
        <Text className="font-sans text-sm text-muted mb-3">
          {t('Choisissez votre spécialisation.')}
        </Text>

        <View className="flex-row flex-wrap mb-4">
          {selected.map((s) => (
            <Pressable
              key={s}
              onPress={() => toggle(s)}
              className="flex-row items-center bg-accent-50 rounded-full px-3 py-1.5 mr-2 mb-2"
            >
              <Text className="font-sans-semibold text-xs" style={{ color: '#9A3412' }}>
                {s}
                {!catalogKeys.has(norm(s)) ? ` · ${t('en attente')}` : ''}
              </Text>
              <X color="#9A3412" size={13} style={{ marginLeft: 6 }} />
            </Pressable>
          ))}
          {!loading && selected.some((s) => !catalogKeys.has(norm(s))) ? (
            <Text className="font-sans text-xs text-muted w-full mt-1">
              {t("La spécialisation « en attente » reste visible sur votre profil mais ne rejoint la liste officielle qu'après validation par l'administrateur.")}
            </Text>
          ) : null}
          {!loading && selected.length === 0 ? (
            <Text className="font-sans text-xs text-muted">{t('Aucune spécialisation sélectionnée.')}</Text>
          ) : null}
        </View>

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('Rechercher (ex : cardio, pédiatrie…)')}
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          className="rounded-2xl px-4 py-3.5 text-base text-ink bg-surface mb-3"
          style={{ borderWidth: 1, borderColor: colors.line, fontFamily: 'Mulish_400Regular' }}
        />

        <View className="bg-surface rounded-3xl border border-line overflow-hidden">
          {query.trim() && !exact && !isSelected(query.trim()) ? (
            <Pressable
              onPress={() => {
                toggle(query.trim());
                setQuery('');
              }}
              className="flex-row items-center px-4 py-3.5 border-b border-line"
            >
              <Plus color={colors.accent} size={16} />
              <Text className="font-sans-semibold text-accent ml-2" numberOfLines={1}>
                {t('Proposer « {value} » (validation admin)', { value: query.trim() })}
              </Text>
            </Pressable>
          ) : null}
          {results.map((s, i) => {
            const on = isSelected(s);
            return (
              <Pressable
                key={s}
                onPress={() => toggle(s)}
                className={`flex-row items-center px-4 py-3.5 ${
                  i < results.length - 1 ? 'border-b border-line' : ''
                }`}
              >
                <Text className={`flex-1 ${on ? 'font-sans-bold text-ink' : 'font-sans text-ink'}`}>{s}</Text>
                {on ? <Check color={colors.accent} size={18} /> : null}
              </Pressable>
            );
          })}
          {results.length === 0 ? (
            <Text className="font-sans text-sm text-muted px-4 py-4">{t('Aucun résultat.')}</Text>
          ) : null}
        </View>

        {errorMsg ? (
          <View className="bg-red-50 rounded-2xl px-4 py-3 mt-4">
            <Text className="font-sans-medium text-sm text-danger text-center">{errorMsg}</Text>
          </View>
        ) : null}

        <Button label={t('Enregistrer')} variant="accent" loading={saving} onPress={onSave} className="mt-5" />
      </ScrollView>
    </SafeAreaView>
  );
}
