import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FolderHeart, Wallet, Calendar, Video, CalendarPlus, ChevronDown, ChevronUp } from 'lucide-react-native';
import { BrandGlyph } from '@/components/BrandGlyph';
import { Avatar, Badge, Card, Eyebrow } from '@/components/ui';
import { NotificationBell } from '@/components/NotificationBell';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { greetingName } from '@/utils/identityNames';
import { useAsync } from '@/hooks/useAsync';
import { useAvatarUri } from '@/hooks/useAvatarUri';
import { getUpcomingConsultations, getPastConsultations } from '@/services/patientApi';
import { useLanguage, useT } from '@/i18n';
import { clockTime, joinButtonState } from '@/utils/nextConsultation';
import { formatMoney } from '@/utils/format';

const quick = [
  { icon: null, label: 'Praticien', href: '/(patient)/doctors' as const, tint: 'bg-sage' },
  { icon: FolderHeart, label: 'Dossiers', href: '/records' as const, tint: 'bg-peach' },
  { icon: Wallet, label: 'Wallet', href: '/(patient)/wallet' as const, tint: 'bg-sand' },
  { icon: Calendar, label: 'RDV', href: '/(patient)/appointments' as const, tint: 'bg-lavender' },
];

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-1">
      <Text className="font-sans text-white/70 text-sm">{label}</Text>
      <Text className="font-sans-semibold text-white text-sm flex-1 text-right ml-3">{value}</Text>
    </View>
  );
}

export default function PatientDashboard() {
  const t = useT();
  const { code: lang } = useLanguage();
  const { user } = useAuth();
  const avatarUri = useAvatarUri(user);
  const uid = user?.id ?? 'patient-1';
  const up = useAsync(() => getUpcomingConsultations(uid), [uid, lang]);
  const pastReq = useAsync(() => getPastConsultations(uid), [uid, lang]);
  const { data: upcoming, loading: upLoading } = up;
  const { data: past } = pastReq;

  // Retour sur l'accueil (ex. après une annulation) : relit les consultations. Le premier focus est déjà couvert
  // par le chargement initial de useAsync.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void Promise.all([up.refresh(), pastReq.refresh()]);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  // Bouton « Rejoindre » grisé avant l'heure prévue (même règle que le prestataire et le serveur).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([up.refresh(), pastReq.refresh()]);
    setRefreshing(false);
  };

  const upList = upcoming ?? [];
  const pastList = past ?? [];
  // Une consultation `pending_payment` n'est pas confirmée : elle ne peut pas être « la prochaine » à rejoindre.
  const next = upList.find((c) => !c.awaitingPayment);

  const join = next
    ? joinButtonState({ rawStatus: next.status === 'in_progress' ? 'in_progress' : 'scheduled', scheduledAt: next.date }, now)
    : null;
  const joinEnabled = join?.enabled ?? false;
  const statusLabel = next?.status === 'in_progress' ? t('En cours') : t('Confirmée');

  const greeting = user ? greetingName(user) : '';
  const initials =
    `${(user?.firstName ?? '').charAt(0)}${(user?.lastName ?? '').charAt(0)}`.toUpperCase() || 'VD';

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {/* Greeting */}
        <View className="flex-row items-center justify-between px-5 pt-3 pb-5">
          <View className="flex-1 pr-3">
            <Text className="font-serif-bold text-2xl text-ink">
              {greeting ? t('Bonjour {name}', { name: greeting }) : t('Bienvenue')}
            </Text>
          </View>
          <View className="flex-row items-center">
            <NotificationBell />
            <Avatar initials={initials} uri={avatarUri} />
          </View>
        </View>

        {/* Prochaine consultation */}
        <View className="px-5 mb-5">
          {upLoading ? (
            <View className="rounded-[28px] bg-primary p-6 items-center justify-center" style={{ minHeight: 160 }}>
              <ActivityIndicator color={colors.white} />
            </View>
          ) : next ? (
            <>
            <View className="rounded-[28px] bg-primary p-6 overflow-hidden">
              <View
                className="absolute -right-8 -top-8 w-36 h-36 rounded-full"
                style={{ backgroundColor: '#15846A', opacity: 0.55 }}
              />
              <Eyebrow className="bg-white/20 mb-3">
                <Text className="font-sans-bold text-white text-xs">{t('Prochaine consultation')}</Text>
              </Eyebrow>
              <Text className="font-serif-bold text-white text-2xl">
                Dr. {next.doctor.firstName} {next.doctor.lastName}
              </Text>
              <Text className="font-sans text-white/80 text-sm mt-1 mb-5">{next.dateLabel} · {t('Vidéo')}</Text>
              <Pressable
                onPress={() => router.push(`/call/${next.roomId ?? next.id}`)}
                disabled={!joinEnabled}
                accessibilityRole="button"
                accessibilityState={{ disabled: !joinEnabled }}
                className={`rounded-2xl py-3.5 flex-row items-center justify-center ${joinEnabled ? 'bg-accent' : 'bg-white/30'}`}
              >
                <Video color={colors.white} size={18} />
                <Text className="font-sans-bold text-white text-base ml-2">{t('Rejoindre la consultation')}</Text>
              </Pressable>
              {join && !join.enabled ? (
                <Text className="font-sans text-white/80 text-xs text-center mt-2">
                  {t('Disponible à {time}', { time: clockTime(join.opensAt) })}
                </Text>
              ) : null}
              <Pressable
                onPress={() => setDetailsOpen((v) => !v)}
                className="flex-row items-center justify-center mt-4"
                accessibilityRole="button"
                accessibilityState={{ expanded: detailsOpen }}
              >
                <Text className="font-sans-semibold text-white text-sm mr-1">
                  {detailsOpen ? t('Masquer les détails') : t('Voir les détails')}
                </Text>
                {detailsOpen ? <ChevronUp color={colors.white} size={16} /> : <ChevronDown color={colors.white} size={16} />}
              </Pressable>
              {detailsOpen ? (
                <View className="mt-3 rounded-2xl bg-white/10 p-4">
                  <DetailRow label={t('Praticien')} value={`Dr. ${next.doctor.firstName} ${next.doctor.lastName}`} />
                  {next.doctor.specialty ? <DetailRow label={t('Spécialité')} value={next.doctor.specialty} /> : null}
                  <DetailRow label={t('Date et heure')} value={next.dateLabel} />
                  <DetailRow label={t('Durée')} value={`${next.durationMin} ${t('min')}`} />
                  <DetailRow label={t('Statut')} value={statusLabel} />
                  {next.fee > 0 ? <DetailRow label={t('Tarif')} value={formatMoney(next.fee)} /> : null}
                </View>
              ) : null}
            </View>
            <Pressable
              onPress={() => router.push('/(patient)/doctors')}
              className="mt-3 rounded-2xl border border-line bg-surface py-3.5 items-center"
              accessibilityRole="button"
            >
              <Text className="font-sans-bold text-primary text-base">{t('Réserver une consultation')}</Text>
            </Pressable>
            </>
          ) : (
            <View className="rounded-[28px] bg-surface border border-line p-6 items-center">
              <View className="w-12 h-12 rounded-2xl bg-primary-50 items-center justify-center mb-3">
                <CalendarPlus color={colors.primary} size={24} />
              </View>
              <Text className="font-serif-bold text-ink text-lg">{t('Aucune consultation à venir')}</Text>
              <Text className="font-sans text-sm text-muted mt-1 mb-4 text-center">
                {t('Trouve un praticien et prends rendez-vous en quelques minutes.')}
              </Text>
              <Pressable
                onPress={() => router.push('/(patient)/doctors')}
                className="bg-primary rounded-2xl py-3.5 px-6 w-full items-center"
              >
                <Text className="font-sans-bold text-white text-base">{t('Prendre rendez-vous')}</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Stats */}
        <View className="px-5 flex-row justify-between mb-5">
          <Pressable className="w-[48%]" onPress={() => router.push('/(patient)/appointments?tab=upcoming' as never)}>
            <Card>
              <Text className="font-serif-bold text-4xl text-ink">{upList.filter((c) => !c.awaitingPayment).length}</Text>
              <Text className="font-sans-semibold text-sm text-ink mt-1">{t('À venir')}</Text>
              <Text className="font-sans text-xs text-muted">{t('consultations')}</Text>
            </Card>
          </Pressable>
          <Pressable className="w-[48%]" onPress={() => router.push('/(patient)/appointments?tab=past' as never)}>
            <Card>
              <Text className="font-serif-bold text-4xl text-ink">{pastList.length}</Text>
              <Text className="font-sans-semibold text-sm text-ink mt-1">{t('Consultations')}</Text>
              <Text className="font-sans text-xs text-muted">{t('au total')}</Text>
            </Card>
          </Pressable>
        </View>

        {/* Accès rapides */}
        <View className="px-5">
          <Text className="font-sans-bold text-ink text-lg mb-3">{t('Accès rapides')}</Text>
          <View className="flex-row justify-between mb-6">
            {quick.map((q) => (
              <Pressable key={q.label} onPress={() => router.push(q.href)} className="items-center w-[23%]">
                <View className={`w-16 h-16 rounded-3xl items-center justify-center mb-2 ${q.tint}`}>
                  {q.icon ? <q.icon color={colors.ink} size={24} /> : <BrandGlyph size={28} color={colors.primary} cameraColor={colors.sage} />}
                </View>
                <Text className="font-sans-medium text-xs text-ink">{t(q.label)}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Récentes */}
        <View className="px-5">
          <Text className="font-sans-bold text-ink text-lg mb-3">{t('Récentes')}</Text>
          {pastList.length === 0 ? (
            <Card>
              <Text className="font-sans text-sm text-muted text-center py-2">
                {t('Aucune consultation récente.')}
              </Text>
            </Card>
          ) : (
            pastList.map((c) => (
              <Card key={c.id} className="mb-3 flex-row items-center">
                <Avatar initials={c.doctor.initials} size={44} tone="light" />
                <View className="flex-1 ml-3.5">
                  <Text className="font-sans-bold text-ink">
                    Dr. {c.doctor.firstName} {c.doctor.lastName}
                  </Text>
                  <Text className="font-sans text-xs text-muted mt-0.5">{c.doctor.specialty}</Text>
                  <Text className="font-sans text-xs text-clay mt-1">
                    {c.dateLabel} · {c.durationMin} {t('min')}
                  </Text>
                </View>
                <Badge label={t('Terminée')} tone="slate" />
              </Card>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
