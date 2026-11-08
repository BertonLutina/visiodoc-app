import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, ChevronRight, Coins, Globe, X } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { getCountry } from '@/config/countries';
import { useAuth } from '@/contexts/AuthContext';
import { isTranslatedLanguage, languageOptions, useLanguage, useT } from '@/i18n';

/**
 * Préférences « Langue » (modifiable, appliquée à toute l'app) et « Devise » (pilotée par le
 * pays du profil). Partagé entre le profil patient (vert) et le profil médecin (orange).
 */
export function PreferencesSection({ tone = 'primary' }: { tone?: 'primary' | 'accent' }) {
  const { user, updateProfile } = useAuth();
  const { language, setLanguage } = useLanguage();
  const t = useT();
  const [open, setOpen] = useState(false);
  const country = getCountry(user?.countryCode ?? 'CD');
  const options = languageOptions(country.languages);
  const tint = tone === 'accent' ? colors.accent : colors.primary;

  const choose = async (lang: string) => {
    setOpen(false);
    if (lang === language) return;
    setLanguage(lang); // effet immédiat dans toute l'app
    try {
      await updateProfile({ preferredLanguage: lang }); // mémorisé sur le compte
    } catch {
      /* la langue reste appliquée sur cet appareil ; elle sera re-synchronisée au prochain choix */
    }
  };

  return (
    <>
      <Text className="font-sans-bold text-ink text-lg mb-3 mt-4 ml-1">{t('Préférences')}</Text>
      <View className="bg-surface rounded-3xl border border-line overflow-hidden">
        <Pressable onPress={() => setOpen(true)} className="flex-row items-center px-4 py-4 border-b border-line">
          <View className="w-10 h-10 rounded-2xl bg-sand items-center justify-center mr-3">
            <Globe color={colors.clay} size={18} />
          </View>
          <Text className="flex-1 text-ink font-sans-semibold">{t('Langue')}</Text>
          <Text className="font-sans-medium text-muted">{language}</Text>
          <ChevronRight color={colors.muted} size={18} />
        </Pressable>
        <View className="flex-row items-center px-4 py-4">
          <View className="w-10 h-10 rounded-2xl bg-sand items-center justify-center mr-3">
            <Coins color={colors.clay} size={18} />
          </View>
          <Text className="flex-1 text-ink font-sans-semibold">{t('Devise')}</Text>
          <Text className="font-sans-medium text-muted">
            {country.currency.symbol} · {country.currency.code}
          </Text>
        </View>
      </View>

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
          <View className="flex-row items-center justify-between px-5 pt-2 pb-3">
            <Text className="font-serif-bold text-2xl text-ink">{t('Choisir une langue')}</Text>
            <Pressable onPress={() => setOpen(false)} hitSlop={10} className="p-1">
              <X color={colors.ink} size={24} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
            {options.map((lang, i) => {
              const active = lang.toLowerCase() === language.toLowerCase();
              const translated = isTranslatedLanguage(lang);
              return (
                <Pressable
                  key={lang}
                  onPress={() => choose(lang)}
                  className={`flex-row items-center py-3.5 ${i < options.length - 1 ? 'border-b border-line' : ''}`}
                >
                  <View className="flex-1">
                    <Text className="text-base text-ink font-sans-medium">{lang}</Text>
                    {!translated ? (
                      <Text className="font-sans text-xs text-muted mt-0.5">
                        {t('Interface en français pour le moment')}
                      </Text>
                    ) : null}
                  </View>
                  {active ? <Check color={tint} size={20} strokeWidth={3} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}
