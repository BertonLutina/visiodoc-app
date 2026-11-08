import React, { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar, Badge, Button, Card } from '@/components/ui';
import { colors } from '@/theme/colors';
import { formatMoney, typeLabel } from '@/utils/format';
import { getCountry, type CountryConfig } from '@/config/countries';
import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import {
  getPastConsultations,
  getUpcomingConsultations,
  payExistingConsultation,
} from '@/services/patientApi';
import { PaymentConfirmationError } from '@/services/paymentAttempt';
import { createOpenPaymentWidget, isPaymentWidgetAvailable } from '@/services/paymentWidget';
import type { Consultation, ConsultationStatus } from '@/types';
import { useLanguage, useT } from '@/i18n';

const statusBadge: Record<ConsultationStatus, { label: string; tone: 'green' | 'amber' | 'slate' }> = {
  confirmed: { label: 'Confirmée', tone: 'green' },
  pending: { label: 'En attente', tone: 'amber' },
  in_progress: { label: 'En cours', tone: 'green' },
  completed: { label: 'Terminée', tone: 'slate' },
  cancelled: { label: 'Annulée', tone: 'slate' },
};

function Row({
  c,
  joinable,
  country,
  onPay,
}: {
  c: Consultation;
  joinable: boolean;
  country: CountryConfig;
  onPay: (c: Consultation) => void;
}) {
  const t = useT();
  // `pending_payment` : réservée mais pas payée → jamais présentée comme confirmée ni rejoignable.
  const sb = c.awaitingPayment ? { label: 'Paiement en attente', tone: 'amber' as const } : statusBadge[c.status];
  return (
    <Card className="mb-3">
      <View className="flex-row items-center">
        <Avatar initials={c.doctor.initials} size={44} tone="light" />
        <View className="flex-1 ml-3.5">
          <Text className="font-sans-bold text-ink">
            Dr. {c.doctor.firstName} {c.doctor.lastName}
          </Text>
          <Text className="font-sans text-xs text-muted mt-0.5">{c.doctor.specialty}</Text>
        </View>
        <Badge label={t(sb.label)} tone={sb.tone} />
      </View>
      <Text className="font-sans-semibold text-sm text-clay mt-3">{c.dateLabel}</Text>
      <Text className="font-sans text-sm text-muted mt-0.5">
        {typeLabel(c.type)} · {c.durationMin} {t('min')} · {formatMoney(c.fee, country)}
      </Text>
      {c.awaitingPayment && (
        <Button label={t('Payer maintenant')} className="mt-3" onPress={() => onPay(c)} />
      )}
      {joinable && c.status !== 'pending' && !c.awaitingPayment && (
        <Button
          label={t('Rejoindre la consultation')}
          className="mt-3"
          onPress={() => router.push(`/call/${c.roomId ?? c.id}`)}
        />
      )}
    </Card>
  );
}

export default function Appointments() {
  const t = useT();
  const { code: lang } = useLanguage();
  const { user } = useAuth();
  const uid = user?.id ?? 'patient-1';
  const country = getCountry(user?.countryCode ?? 'CD');
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const up = useAsync(() => getUpcomingConsultations(uid), [uid, lang]);
  const pastReq = useAsync(() => getPastConsultations(uid), [uid, lang]);
  const data = (tab === 'upcoming' ? up.data : pastReq.data) ?? [];

  // Relit toujours la base au retour sur l'écran (après un paiement, `scheduled`/`paid` viennent du serveur).
  useFocusEffect(
    useCallback(() => {
      up.refresh();
      pastReq.refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const { user: payer } = useAuth();
  const onPay = async (c: Consultation) => {
    if (!c.currency || !isPaymentWidgetAvailable()) {
      Alert.alert(t('Paiement indisponible.'), t("Le paiement n'est pas disponible pour le moment. Réessaie plus tard."));
      return;
    }
    try {
      const result = await payExistingConsultation(
        c.id,
        createOpenPaymentWidget({
          amount: c.fee,
          currency: c.currency,
          customerId: payer?.id ?? '',
          customerName: payer ? `${payer.firstName} ${payer.lastName}` : '',
          customerEmail: payer?.email ?? '',
          payItemName: t('Consultation'),
        }),
      );
      if (result.status === 'cancelled') {
        Alert.alert(
          t('Paiement non effectué'),
          t('Ta consultation est réservée mais en attente de paiement. Tu peux payer plus tard depuis Mes consultations.'),
        );
      }
    } catch (e: any) {
      Alert.alert(
        e instanceof PaymentConfirmationError ? t('Paiement en cours de confirmation') : t('Paiement non démarré'),
        e?.message ?? t('Réessayez plus tard.'),
      );
    } finally {
      await Promise.all([up.refresh(), pastReq.refresh()]);
    }
  };

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([up.refresh(), pastReq.refresh()]);
    setRefreshing(false);
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="px-5 pt-2">
        <Text className="font-serif-bold text-3xl text-ink mb-4" style={{ letterSpacing: -0.3 }}>
          {t('Mes consultations')}
        </Text>
        <View className="flex-row bg-surface border border-line rounded-2xl p-1 mb-2">
          {(['upcoming', 'past'] as const).map((k) => (
            <Pressable
              key={k}
              onPress={() => setTab(k)}
              className={`flex-1 py-2.5 rounded-xl items-center ${tab === k ? 'bg-primary' : ''}`}
            >
              <Text className={`font-sans-bold ${tab === k ? 'text-white' : 'text-muted'}`}>
                {k === 'upcoming' ? t('À venir') : t('Passées')}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: 12 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {data.map((c) => (
          <Row key={c.id} c={c} joinable={tab === 'upcoming'} country={country} onPay={onPay} />
        ))}
        {data.length === 0 && (
          <Text className="text-center font-sans text-muted mt-10">
            {tab === 'upcoming' ? t('Aucune consultation à venir.') : t('Aucune consultation passée.')}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
