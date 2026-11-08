import React, { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AlertTriangle,
  CalendarClock,
  CalendarOff,
  ChevronRight,
  Coins,
  FolderHeart,
  Info,
  Star,
  Users,
  Wallet,
} from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { Avatar, Badge, Card, SectionTitle, Stars } from '@/components/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import {
  getDashboardOverview,
  getReviewSummary,
  getTodayConsultations,
  getValidationStatus,
  startConsultation,
} from '@/services/providerApi';
import { buildAlerts, countdownLabel } from '@/services/dashboardMetrics';
import { currentProvider } from '@/data/mockProvider';
import { formatDoctorFee, formatMoney, typeLabel } from '@/utils/format';
import { translate } from '@/i18n';
import type { ProviderConsultation } from '@/types/provider';
import { useLanguage, useT } from '@/i18n';

const SHORTCUTS: { label: string; icon: typeof Users; href: Href }[] = [
  { label: 'Disponibilités', icon: CalendarClock, href: '/provider/availability' },
  { label: 'Congés', icon: CalendarOff, href: '/provider/availability-overrides' },
  { label: 'Tarif', icon: Coins, href: '/provider/fee' },
  { label: 'Patients', icon: Users, href: '/(provider)/patients' },
  { label: 'Dossiers', icon: FolderHeart, href: '/(provider)/records' },
  { label: 'Abonnement', icon: Wallet, href: '/provider/subscription' },
];

const ALERT_STYLE = {
  info: { bg: '#EFF6FF', fg: '#1E40AF', Icon: Info },
  warning: { bg: '#FFFBEB', fg: '#92400E', Icon: AlertTriangle },
  danger: { bg: '#FEF2F2', fg: '#991B1B', Icon: AlertTriangle },
} as const;

function statusBadge(c: ProviderConsultation) {
  switch (c.rawStatus) {
    case 'completed':
      return <Badge label={translate('Terminée')} tone="green" />;
    case 'in_progress':
      return <Badge label={translate('En cours')} tone="green" />;
    case 'cancelled':
      return <Badge label={translate('Annulée')} tone="red" />;
    case 'no_show':
      return <Badge label={translate('Absent')} tone="red" />;
    case 'pending_payment':
      return <Badge label={translate('Paiement en attente')} tone="amber" />;
    default:
      return <Badge label={c.status === 'pending' ? translate('En attente') : translate('Confirmée')} tone={c.status === 'pending' ? 'amber' : 'green'} />;
  }
}

function Stat({
  value,
  label,
  hint,
  hintTone = 'muted',
  onPress,
}: {
  value: string;
  label: string;
  hint?: string;
  hintTone?: 'muted' | 'success';
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} className="w-[48%] mb-3">
      <Card>
        <Text className="font-serif-bold text-3xl text-ink">{value}</Text>
        <Text className="font-sans-semibold text-sm text-ink mt-1">{label}</Text>
        {!!hint && (
          <Text className={`font-sans text-xs ${hintTone === 'success' ? 'text-success' : 'text-muted'}`}>{hint}</Text>
        )}
      </Card>
    </Pressable>
  );
}

export default function ProviderDashboard() {
  const t = useT();
  const { code: lang } = useLanguage();
  const { user } = useAuth();
  const uid = user?.id ?? currentProvider.id;
  const overviewReq = useAsync(() => getDashboardOverview(uid), [uid, lang]);
  const todayReq = useAsync(() => getTodayConsultations(uid), [uid, lang]);
  const reviewsReq = useAsync(() => getReviewSummary(uid), [uid]);
  const statusReq = useAsync(() => getValidationStatus(uid), [uid]);

  const ov = overviewReq.data;
  const reviews = reviewsReq.data;
  const today = todayReq.data ?? [];
  const validationStatus = statusReq.data ?? null;

  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([overviewReq.refresh(), todayReq.refresh(), reviewsReq.refresh(), statusReq.refresh()]);
    setRefreshing(false);
  };

  const displayName = user
    ? `Dr. ${user.firstName} ${user.lastName}`.trim()
    : `Dr. ${currentProvider.firstName} ${currentProvider.lastName}`;
  const initials = user
    ? `${(user.firstName ?? '').charAt(0)}${(user.lastName ?? '').charAt(0)}`.toUpperCase() || 'DR'
    : currentProvider.initials;

  const alerts = ov ? buildAlerts({ validationStatus, overview: ov }) : [];
  const next = ov?.next ?? null;
  const maxRevenue = Math.max(1, ...(ov?.revenueSeries.map((m) => m.amount) ?? [1]));
  const subtitle = !ov
    ? ''
    : today.length > 0
      ? today.length > 1
        ? t("Vous avez {n} consultations aujourd'hui.", { n: today.length })
        : t("Vous avez 1 consultation aujourd'hui.")
      : t("Aucune consultation aujourd'hui.");

  const onStart = async (c: ProviderConsultation) => {
    setStarting(true);
    try {
      await startConsultation(c.id);
      router.push(`/call/${c.roomId ?? c.id}`);
    } finally {
      setStarting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />
        }
      >
        {/* Greeting */}
        <View className="flex-row items-center justify-between px-5 pt-3 pb-4">
          <View className="flex-1 pr-3">
            <Text className="font-sans-medium text-sm text-muted">{t('Bonjour,')}</Text>
            <Text className="font-serif-bold text-2xl text-ink mt-0.5">{displayName}</Text>
            {!!subtitle && <Text className="font-sans text-sm text-muted mt-1">{subtitle}</Text>}
          </View>
          <Avatar initials={initials} tone="clay" uri={user?.avatarUrl} />
        </View>

        {overviewReq.loading && !ov && (
          <View className="py-10 items-center">
            <ActivityIndicator color={colors.accent} />
          </View>
        )}
        {!!overviewReq.error && !ov && (
          <View className="px-5 mb-4">
            <Card>
              <Text className="font-sans-semibold text-ink">{t('Impossible de charger le tableau de bord.')}</Text>
              <Text className="font-sans text-xs text-muted mt-1">{overviewReq.error}</Text>
              <Pressable onPress={onRefresh} className="mt-3">
                <Text className="font-sans-bold text-accent">{t('Réessayer')}</Text>
              </Pressable>
            </Card>
          </View>
        )}

        {/* Alertes à traiter */}
        {alerts.length > 0 && (
          <View className="px-5 mb-4">
            {alerts.map((a) => {
              const st = ALERT_STYLE[a.tone];
              return (
                <Pressable
                  key={a.id}
                  onPress={() => router.push(a.href as Href)}
                  className="rounded-2xl px-4 py-3 mb-2 flex-row items-center"
                  style={{ backgroundColor: st.bg }}
                >
                  <st.Icon size={18} color={st.fg} />
                  <Text className="flex-1 font-sans-semibold text-sm ml-3" style={{ color: st.fg }}>
                    {a.message}
                  </Text>
                  <ChevronRight size={18} color={st.fg} />
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Prochaine consultation */}
        {next && (
          <View className="px-5 mb-5">
            <SectionTitle>{t('Prochaine consultation')}</SectionTitle>
            <Card>
              <View className="flex-row items-center">
                <Avatar initials={next.patient.initials} size={46} tone="light" />
                <View className="flex-1 ml-3.5">
                  <Text className="font-sans-bold text-ink text-base">
                    {next.patient.firstName} {next.patient.lastName}
                  </Text>
                  <Text className="font-sans text-xs text-muted mt-0.5" numberOfLines={1}>
                    {next.reason || t('Motif non précisé')}
                  </Text>
                </View>
                {next.scheduledAt && (
                  <Badge label={countdownLabel(new Date(next.scheduledAt), new Date())} tone="amber" />
                )}
              </View>
              <Text className="font-sans-semibold text-sm text-clay mt-3">
                {next.dateLabel} · {typeLabel(next.type)} · {next.durationMin} {t('min')}
              </Text>
              <Pressable
                onPress={() => onStart(next)}
                disabled={starting}
                className="bg-accent rounded-2xl py-3.5 items-center mt-3"
                style={{ opacity: starting ? 0.6 : 1 }}
              >
                <Text className="text-white font-sans-bold">{t('Démarrer la consultation')}</Text>
              </Pressable>
            </Card>
          </View>
        )}

        {/* Raccourcis */}
        <View className="px-5 mb-3">
          <SectionTitle>{t('Raccourcis')}</SectionTitle>
          <View className="flex-row flex-wrap justify-between">
            {SHORTCUTS.map(({ label, icon: Icon, href }) => (
              <Pressable
                key={label}
                onPress={() => router.push(href)}
                className="w-[31%] bg-surface border border-line rounded-2xl py-3.5 items-center mb-3"
              >
                <Icon size={22} color={colors.accent} />
                <Text className="font-sans-semibold text-xs text-ink mt-1.5">{t(label)}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {ov && (
          <>
            {/* Chiffres clés */}
            <View className="px-5 flex-row flex-wrap justify-between mb-2">
              <Stat
                value={String(ov.patientsTotal)}
                label={t('Patients total')}
                hint={t('ce mois +{n}', { n: ov.patientsNew })}
                hintTone="success"
                onPress={() => router.push('/(provider)/patients')}
              />
              <Stat
                value={String(ov.consultationsThisMonth)}
                label={t('Consult./mois')}
                hint={ov.consultationsTrend}
                hintTone="success"
                onPress={() => router.push('/(provider)/consultations')}
              />
              <Stat
                value={formatDoctorFee(ov.netRevenue, ov.revenueCurrency) ?? formatMoney(ov.netRevenue)}
                label={t('Revenus du mois')}
                hint={t('consultations payées')}
              />
              <Stat
                value={reviews?.average != null ? reviews.average.toFixed(1) : '—'}
                label={t('Note moyenne')}
                hint={reviews ? `${reviews.count} ${t('avis')}` : undefined}
              />
              <Stat
                value={ov.fillRate != null ? `${ov.fillRate}%` : '—'}
                label={t('Remplissage')}
                hint={ov.fillRate != null ? t('{booked}/{cap} créneaux · 7 j', { booked: ov.weekBooked, cap: ov.weekCapacity }) : t('Aucune disponibilité')}
                onPress={() => router.push('/provider/availability')}
              />
              <Stat
                value={ov.cancellationRate != null ? `${ov.cancellationRate}%` : '—'}
                label={t('Annulations')}
                hint={ov.noShowRate != null ? t("{n}% d'absences · 90 j", { n: ov.noShowRate }) : t('90 derniers jours')}
              />
            </View>

            {/* Agenda de la semaine */}
            <View className="px-5 mb-5">
              <SectionTitle>{t('Cette semaine')}</SectionTitle>
              <Card>
                <View className="flex-row justify-between">
                  {ov.weekAgenda.map((d) => (
                    <View key={d.date} className="items-center flex-1">
                      <Text className="font-sans text-xs text-muted">{t(d.label)}</Text>
                      <View
                        className="w-9 h-9 rounded-full items-center justify-center mt-1.5"
                        style={{ backgroundColor: d.isToday ? colors.accent : d.count > 0 ? colors.accentLight : 'transparent' }}
                      >
                        <Text
                          className="font-sans-bold text-sm"
                          style={{ color: d.isToday ? '#FFFFFF' : d.count > 0 ? colors.clay : colors.muted }}
                        >
                          {d.count}
                        </Text>
                      </View>
                      <Text className="font-sans text-[10px] text-muted mt-1">{d.dayNumber}</Text>
                    </View>
                  ))}
                </View>
              </Card>
            </View>

            {/* Revenus 6 mois */}
            <View className="px-5 mb-5">
              <SectionTitle>{t('Revenus · 6 mois')}</SectionTitle>
              <Card>
                <View className="flex-row items-end justify-between" style={{ height: 110 }}>
                  {ov.revenueSeries.map((m, i) => (
                    <View key={`${m.label}-${i}`} className="items-center flex-1">
                      <View
                        className="w-7 rounded-lg"
                        style={{
                          height: Math.max(4, Math.round((m.amount / maxRevenue) * 90)),
                          backgroundColor: i === ov.revenueSeries.length - 1 ? colors.accent : colors.accentLight,
                        }}
                      />
                      <Text className="font-sans text-[10px] text-muted mt-1.5">{t(m.label)}</Text>
                    </View>
                  ))}
                </View>
                {ov.revenueSeries.every((m) => m.amount === 0) && (
                  <Text className="font-sans text-xs text-muted mt-3">
                    {t('Aucun revenu encaissé sur la période (consultations payées).')}
                  </Text>
                )}
              </Card>
              {(ov.earnings.inProgress.length > 0 || ov.earnings.paid.length > 0) && (
                <Card className="mt-3">
                  <Text className="font-sans-semibold text-sm text-ink">{t('Pas encore versé')}</Text>
                  {ov.earnings.inProgress.length === 0 ? (
                    <Text className="font-sans text-xs text-muted mt-1">—</Text>
                  ) : (
                    ov.earnings.inProgress.map((e) => (
                      <Text key={`ip-${e.currency ?? ''}`} className="font-serif-bold text-primary text-lg mt-1">
                        {formatDoctorFee(e.amount, e.currency) ?? formatMoney(e.amount)}
                      </Text>
                    ))
                  )}
                  <Text className="font-sans-semibold text-sm text-ink mt-3">{t('Déjà versé')}</Text>
                  {ov.earnings.paid.length === 0 ? (
                    <Text className="font-sans text-xs text-muted mt-1">—</Text>
                  ) : (
                    ov.earnings.paid.map((e) => (
                      <Text key={`pd-${e.currency ?? ''}`} className="font-serif-bold text-primary text-lg mt-1">
                        {formatDoctorFee(e.amount, e.currency) ?? formatMoney(e.amount)}
                      </Text>
                    ))
                  )}
                </Card>
              )}
            </View>
          </>
        )}

        {/* Consultations aujourd'hui */}
        <View className="px-5">
          <SectionTitle>{t("Consultations aujourd'hui")}</SectionTitle>
          {today.length === 0 && !todayReq.loading && (
            <Card className="mb-3">
              <Text className="font-sans text-sm text-muted">{t("Rien de prévu aujourd'hui. Profitez-en pour mettre à jour vos dossiers.")}</Text>
            </Card>
          )}
          {today.map((c) => (
            <Card key={c.id} className="mb-3 flex-row items-center">
              <Avatar initials={c.patient.initials} size={42} tone="light" />
              <View className="flex-1 ml-3.5">
                <Text className="font-sans-bold text-ink">
                  {c.patient.firstName} {c.patient.lastName}
                </Text>
                <Text className="font-sans text-xs text-clay mt-0.5">
                  {c.dateLabel} · {typeLabel(c.type)}
                </Text>
              </View>
              {statusBadge(c)}
            </Card>
          ))}
        </View>

        {/* Avis récents */}
        <View className="px-5">
          <SectionTitle>{t('Avis récents')}</SectionTitle>
          {reviews && reviews.count > 0 && (
            <Card className="mb-3">
              <View className="flex-row items-center">
                <Star size={20} color={colors.warning} fill={colors.warning} />
                <Text className="font-serif-bold text-2xl text-ink ml-2">
                  {reviews.average != null ? reviews.average.toFixed(1) : '—'}
                </Text>
                <Text className="font-sans text-xs text-muted ml-2">{reviews.count} {t('avis')}</Text>
              </View>
              <View className="mt-3">
                {[5, 4, 3, 2, 1].map((n) => {
                  const total = reviews.distribution.reduce((a, b) => a + b, 0) || 1;
                  const pct = Math.round((reviews.distribution[n - 1] / total) * 100);
                  return (
                    <View key={n} className="flex-row items-center mb-1.5">
                      <Text className="font-sans text-xs text-muted w-4">{n}</Text>
                      <View className="flex-1 h-2 rounded-full bg-line mx-2 overflow-hidden">
                        <View className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: colors.warning }} />
                      </View>
                      <Text className="font-sans text-xs text-muted w-8 text-right">{pct}%</Text>
                    </View>
                  );
                })}
              </View>
            </Card>
          )}
          {reviews && reviews.recent.length === 0 && (
            <Card className="mb-3">
              <Text className="font-sans text-sm text-muted">
                {t("Pas encore d'avis. Ils apparaîtront ici après vos premières consultations notées.")}
              </Text>
            </Card>
          )}
          {reviews?.recent.map((r) => (
            <Card key={r.id} className="mb-3">
              <Stars rating={r.rating} />
              <Text className="font-serif text-ink text-base mt-2 leading-6">"{r.comment}"</Text>
              <Text className="font-sans text-xs text-muted mt-2">
                {r.author} · {r.date}
              </Text>
            </Card>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
