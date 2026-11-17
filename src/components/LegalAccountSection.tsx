import React from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { ChevronRight, FileText, Shield, Trash2 } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/i18n';

const WEB = 'https://cd.visiodoc.online/';
export const SUPPORT_EMAIL = 'support@visiodoc.app';

/**
 * Infos légales (pages du site web, ouvertes dans le navigateur) + suppression de compte.
 * La suppression est une demande envoyée par email au support (pas d'API de suppression côté serveur).
 */
export function LegalAccountSection() {
  const t = useT();
  const { user } = useAuth();

  const rows = [
    { icon: FileText, label: "Conditions d'utilisation", legal: 'conditions' },
    { icon: Shield, label: 'Confidentialité', legal: 'confidentialite' },
    { icon: FileText, label: 'Mentions légales', legal: 'mentions' },
  ];

  const askDelete = () =>
    Alert.alert(
      t('Supprimer mon compte'),
      t('Une demande de suppression sera envoyée à notre équipe par email. Votre compte et vos données seront supprimés.'),
      [
        { text: t('Annuler'), style: 'cancel' },
        {
          text: t('Continuer'),
          style: 'destructive',
          onPress: () =>
            Linking.openURL(
              `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Suppression de compte VisioDoc')}&body=${encodeURIComponent(
                `Je demande la suppression de mon compte.\nIdentifiant : ${user?.id ?? ''}\nEmail : ${user?.email ?? ''}`,
              )}`,
            ),
        },
      ],
    );

  return (
    <>
      <Text className="font-sans-bold text-ink text-lg mb-3 mt-4 ml-1">{t('Informations légales')}</Text>
      <View className="bg-surface rounded-3xl border border-line overflow-hidden">
        {rows.map((r) => (
          <Pressable
            key={r.legal}
            onPress={() => WebBrowser.openBrowserAsync(`${WEB}?legal=${r.legal}`)}
            className="flex-row items-center px-4 py-4 border-b border-line"
          >
            <View className="w-10 h-10 rounded-2xl bg-sand items-center justify-center mr-3">
              <r.icon color={colors.clay} size={18} />
            </View>
            <Text className="flex-1 text-ink font-sans-semibold">{t(r.label)}</Text>
            <ChevronRight color={colors.muted} size={18} />
          </Pressable>
        ))}
        <Pressable onPress={askDelete} className="flex-row items-center px-4 py-4">
          <View className="w-10 h-10 rounded-2xl bg-sand items-center justify-center mr-3">
            <Trash2 color={colors.danger} size={18} />
          </View>
          <Text className="flex-1 text-danger font-sans-semibold">{t('Supprimer mon compte')}</Text>
        </Pressable>
      </View>
    </>
  );
}
