import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronRight, Download, FileText, Shield, ShieldOff, Trash2 } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/i18n';
import {
  exportMyData,
  requestAccountDeletion,
  shareExport,
  withdrawHealthConsent,
} from '@/services/legal';
import { legalDocHref, type LegalDocSlug } from '@/config/legalDocuments';

export const SUPPORT_EMAIL = 'support@visiodoc.app';

/**
 * Infos légales (écrans de lecture internes) + droits sur les données (MOB-1811-6) :
 * export, demande de suppression (traitée par l'équipe sous 30 jours, rien n'est effacé tout de suite) et,
 * pour un patient, retrait du consentement santé (sans déconnexion).
 */
export function LegalAccountSection() {
  const t = useT();
  const { user } = useAuth();
  const [busy, setBusy] = useState<'export' | 'delete' | 'withdraw' | null>(null);

  const rows: { icon: typeof FileText; label: string; slug: LegalDocSlug }[] = [
    { icon: FileText, label: "Conditions d'utilisation", slug: 'cgu-patient' },
    { icon: Shield, label: 'Confidentialité', slug: 'confidentialite' },
    { icon: FileText, label: 'Mentions légales', slug: 'mentions' },
  ];

  const run = async (kind: 'export' | 'delete' | 'withdraw', task: () => Promise<void>) => {
    setBusy(kind);
    try {
      await task();
    } catch (e: any) {
      Alert.alert(t('Une erreur est survenue. Réessaie.'), e?.message ?? '');
    } finally {
      setBusy(null);
    }
  };

  const doExport = () =>
    run('export', async () => {
      await shareExport(await exportMyData());
    });

  const askDelete = () =>
    Alert.alert(
      t('Demander la suppression de mon compte'),
      t(
        "Votre demande sera traitée par notre équipe sous 30 jours. Rien n'est effacé tout de suite : votre compte reste utilisable jusqu'au traitement de la demande.",
      ),
      [
        { text: t('Annuler'), style: 'cancel' },
        {
          text: t('Envoyer la demande'),
          style: 'destructive',
          onPress: () =>
            run('delete', async () => {
              const outcome = await requestAccountDeletion();
              Alert.alert(
                outcome === 'already_pending'
                  ? t('Une demande est déjà en cours.')
                  : t('Demande envoyée. Elle sera traitée sous 30 jours.'),
              );
            }),
        },
      ],
    );

  const askWithdraw = () =>
    Alert.alert(
      t('Retirer mon consentement santé'),
      t(
        "Visiodoc ne pourra plus traiter vos données de santé pour vos consultations. Vous pourrez rester connecté, mais prendre ou suivre une consultation peut devenir impossible tant que vous n'aurez pas donné de nouveau votre consentement.",
      ),
      [
        { text: t('Annuler'), style: 'cancel' },
        {
          text: t('Retirer'),
          style: 'destructive',
          onPress: () =>
            run('withdraw', async () => {
              const count = await withdrawHealthConsent();
              Alert.alert(count > 0 ? t('Votre consentement santé a été retiré.') : t('Aucun consentement santé actif à retirer.'));
            }),
        },
      ],
    );

  const actions = [
    { key: 'export' as const, icon: Download, label: 'Exporter mes données', onPress: doExport, danger: false },
    ...(user?.role === 'patient'
      ? [{ key: 'withdraw' as const, icon: ShieldOff, label: 'Retirer mon consentement santé', onPress: askWithdraw, danger: false }]
      : []),
    { key: 'delete' as const, icon: Trash2, label: 'Demander la suppression de mon compte', onPress: askDelete, danger: true },
  ];

  return (
    <>
      <Text className="font-sans-bold text-ink text-lg mb-3 mt-4 ml-1">{t('Informations légales')}</Text>
      <View className="bg-surface rounded-3xl border border-line overflow-hidden">
        {rows.map((r) => (
          <Pressable
            key={r.slug}
            onPress={() => router.push(legalDocHref(r.slug))}
            className="flex-row items-center px-4 py-4 border-b border-line"
          >
            <View className="w-10 h-10 rounded-2xl bg-sand items-center justify-center mr-3">
              <r.icon color={colors.clay} size={18} />
            </View>
            <Text className="flex-1 text-ink font-sans-semibold">{t(r.label)}</Text>
            <ChevronRight color={colors.muted} size={18} />
          </Pressable>
        ))}
        {actions.map((a, i) => (
          <Pressable
            key={a.key}
            onPress={a.onPress}
            disabled={busy !== null}
            className={`flex-row items-center px-4 py-4 ${i < actions.length - 1 ? 'border-b border-line' : ''}`}
          >
            <View className="w-10 h-10 rounded-2xl bg-sand items-center justify-center mr-3">
              <a.icon color={a.danger ? colors.danger : colors.clay} size={18} />
            </View>
            <Text className={`flex-1 font-sans-semibold ${a.danger ? 'text-danger' : 'text-ink'}`}>{t(a.label)}</Text>
            {busy === a.key ? <ActivityIndicator color={colors.muted} /> : null}
          </Pressable>
        ))}
      </View>
    </>
  );
}
