import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Phone } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/i18n';

/** Vrai si le profil n'a pas de numéro : on invite (sans jamais bloquer) à en ajouter un. */
export const needsPhoneInvite = (user: { phone?: string | null } | null | undefined): boolean =>
  !!user && !(user.phone ?? '').trim();

/**
 * Invitation NON bloquante (le téléphone est facultatif) : affichée dans le profil seulement quand
 * le compte n'a pas de numéro, avec un bouton vers l'édition du profil.
 */
export function PhoneInvite() {
  const t = useT();
  const { user } = useAuth();
  if (!needsPhoneInvite(user)) return null;
  return (
    <View testID="phone-invite" className="bg-surface rounded-3xl border border-line px-4 py-4 mb-4 flex-row items-center">
      <View className="w-10 h-10 rounded-2xl bg-primary-50 items-center justify-center mr-3">
        <Phone color={colors.primary} size={18} />
      </View>
      <Text className="flex-1 font-sans text-sm text-ink mr-3">
        {t('Ajoute ton numéro pour recevoir les rappels par SMS ou WhatsApp.')}
      </Text>
      <Pressable
        testID="phone-invite-button"
        onPress={() => router.push('/profile-edit')}
        accessibilityRole="button"
        className="px-3 py-2 rounded-full bg-primary"
      >
        <Text className="font-sans-bold text-xs text-white">{t('Ajouter mon numéro')}</Text>
      </Pressable>
    </View>
  );
}
