import React, { useCallback, useRef, useState } from 'react';
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
import { PaymentConfirmationError, reconcilePendingPayments } from '@/services/paymentAttempt';
import { listPendingAttempts } from '@/services/pendingPaymentAttempt';
import { createOpenPaymentWidget, paymentWidgetPreflight } from '@/services/paymentWidget';
import { createBusyLock } from '@/utils/busyLock';
import { canPayNow } from '@/utils/canPayNow';
import { showDismissedPaymentPrompt } from '@/utils/paymentPrompts';
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
  paying,
  canPay,
}: {
  c: Consultation;
  joinable: boolean;
  country: CountryConfig;
  onPay: (c: Consultation) => void;
  paying: boolean;
  canPay: boolean;
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
      {canPay && (
        <Button
          label={t('Payer maintenant')}
          className="mt-3"
          loading={paying}
          disabled={paying}
          onPress={() => onPay(c)}
        />
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

  // Tentatives de paiement mémorisées (AsyncStorage) : débit possible sans confirmation reçue.
  // Filtrées par utilisateur : rien n'est effacé à la déconnexion, on ne voit que celles du compte courant.
  const attempts = useAsync(() => (user?.id ? listPendingAttempts(user.id) : Promise.resolve([])), [user?.id]);
  const attemptIds = new Set((attempts.data ?? []).map((a) => a.consultationId));

  // Au retour sur l'écran : rejoue `confirm` pour un paiement resté non confirmé (même txnRef / payRef), puis
  // relit la base (après un paiement, `scheduled`/`paid` viennent du serveur).
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const supportCases = await reconcilePendingPayments();
        if (supportCases.length > 0 && active) {
          // Payé mais consultation expirée / annulée : on garde la référence et on oriente vers le support.
          Alert.alert(
            t('Paiement en cours de confirmation'),
            `${t('Paiement reçu mais consultation non confirmée : contacte le support avec la référence')} ${supportCases
              .map((c) => c.txnRef)
              .join(', ')}`,
          );
        }
        if (!active) return;
        await Promise.all([up.refresh(), pastReq.refresh(), attempts.refresh()]);
      })();
      return () => {
        active = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const { user: payer } = useAuth();
  const payLock = useRef(createBusyLock()).current; // verrou synchrone : un double appui ne lance qu'un paiement
  const [payingId, setPayingId] = useState<string | null>(null);

  const pay = async (c: Consultation, override: boolean) => {
    const check = paymentWidgetPreflight(c.currency);
    if (!check.ok) {
      Alert.alert(t('Paiement indisponible.'), t("Le paiement n'est pas disponible pour le moment. Réessaie plus tard."));
      return;
    }
    try {
      const result = await payExistingConsultation(
        c.id,
        createOpenPaymentWidget({
          amount: c.fee,
          currency: c.currency!,
          customerId: payer?.id ?? '',
          customerName: payer ? `${payer.firstName} ${payer.lastName}` : '',
          customerEmail: payer?.email ?? '',
          payItemName: t('Consultation'),
        }),
        { override },
      );
      if (result.status === 'cancelled') {
        Alert.alert(
          t('Paiement non effectué'),
          t('Ta consultation est réservée mais en attente de paiement. Tu peux payer plus tard depuis Mes consultations.'),
        );
      } else if (result.status === 'dismissed') {
        showDismissedPaymentPrompt(c.id, result.reason, t);
      } else if (result.status === 'verifying') {
        const message = t('Paiement en cours de vérification, ne repaie pas. Réessaie dans quelques minutes.');
        if (result.canOverride) {
          // Plus de 15 min : reprise possible mais explicite (le serveur libère alors le créneau).
          Alert.alert(t('Paiement en cours de confirmation'), message, [
            { text: t('Annuler'), style: 'cancel' },
            { text: t('Payer quand même'), style: 'destructive', onPress: () => void payLock.run(() => pay(c, true)) },
          ]);
        } else {
          Alert.alert(t('Paiement en cours de confirmation'), message);
        }
      }
    } catch (e: any) {
      Alert.alert(
        e instanceof PaymentConfirmationError ? t('Paiement en cours de confirmation') : t('Paiement non démarré'),
        e?.message ?? t('Réessayez plus tard.'),
      );
    } finally {
      await Promise.all([up.refresh(), pastReq.refresh(), attempts.refresh()]);
    }
  };

  const onPay = (c: Consultation) => {
    void payLock.run(async () => {
      setPayingId(c.id);
      try {
        await pay(c, false);
      } finally {
        setPayingId(null);
      }
    });
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
          <Row
            key={c.id}
            c={c}
            joinable={tab === 'upcoming'}
            country={country}
            onPay={onPay}
            paying={payingId === c.id}
            canPay={canPayNow(c, Date.now(), attemptIds.has(c.id))}
          />
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
