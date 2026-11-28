import React, { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CheckCircle2, ChevronLeft, CreditCard, Lock, Smartphone } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { appLocale, useT } from '@/i18n';
import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { supabaseConfigured } from '@/lib/supabase';
import { getCountry } from '@/config/countries';
import { formatMoney } from '@/utils/format';
import { createBusyLock } from '@/utils/busyLock';
import { createOpenPaymentWidget, paymentWidgetPreflight } from '@/services/paymentWidget';
import { subscriptionScreenState } from '@/services/accessPolicy';
import {
  createSingleSuccessNotifier,
  getSubscriptionState,
  paySubscriptionWithCard,
  startSubscriptionPayment,
  type SubscriptionPaymentChannel,
  type SubscriptionPlan,
} from '@/services/subscription';
import { MobileMoneyModal } from '@/components/MobileMoneyModal';

export default function Subscription() {
  const t = useT();
  const { user, logout } = useAuth();
  const { showLogout, showBack } = subscriptionScreenState(user);
  const country = getCountry(user?.countryCode ?? 'CD');
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan>('monthly');
  const [submitting, setSubmitting] = useState(false);
  const [mmSubscriptionId, setMmSubscriptionId] = useState<string | null>(null);
  const payLock = useRef(createBusyLock()).current;
  const successGuardRef = useRef<(() => Promise<void>) | null>(null);

  const {
    data: subState,
    loading,
    reload,
  } = useAsync(
    () => (supabaseConfigured && user?.id ? getSubscriptionState(user.id) : Promise.resolve({ prices: null, active: null })),
    [user?.id],
  );

  const onLogout = async () => {
    await logout();
    router.replace('/(auth)/login-provider');
  };

  const resetSuccessGuard = () => {
    successGuardRef.current = createSingleSuccessNotifier(async () => {
      await reload();
      Alert.alert(t('Abonnement activé'), t('Ton abonnement praticien est maintenant actif.'));
    });
  };

  const triggerSuccessOnce = async () => {
    if (!successGuardRef.current) {
      resetSuccessGuard();
    }
    await successGuardRef.current?.();
  };

  const prices = subState?.prices ?? null;
  const active = subState?.active ?? null;
  const selectedAmount = prices ? (selectedPlan === 'monthly' ? prices.monthly : prices.annual) : 0;
  const amountLabel = prices ? formatMoney(selectedAmount, country) : undefined;
  const isCdf = prices?.currencyCode === 'CDF';

  const startPayment = (channel: SubscriptionPaymentChannel) => {
    if (!user?.id || !prices) return;
    if (channel === 'card' && !paymentWidgetPreflight(prices.currencyCode).ok) {
      Alert.alert(t('Paiement indisponible.'), t("Le paiement n'est pas disponible pour le moment. Réessaie plus tard."));
      return;
    }

    resetSuccessGuard();

    void payLock.run(async () => {
      setSubmitting(true);
      try {
        const res = await startSubscriptionPayment({
          providerId: user.id,
          plan: selectedPlan,
          amount: selectedAmount,
          currencyCode: prices.currencyCode,
          channel,
          openPaymentWidget: createOpenPaymentWidget({
            amount: selectedAmount,
            currency: prices.currencyCode,
            customerId: user.id,
            customerName: `${user.firstName} ${user.lastName}`.trim(),
            customerEmail: user.email ?? '',
            payItemName: selectedPlan === 'monthly' ? t('Abonnement mensuel') : t('Abonnement annuel'),
          }),
        });

        if (res.channel === 'mobile_money') {
          setMmSubscriptionId(res.subscriptionId);
        } else if (res.status === 'confirmed') {
          await triggerSuccessOnce();
        }
      } catch (e: any) {
        Alert.alert(t('Erreur'), e?.message ?? t('Impossible de démarrer le paiement.'));
      } finally {
        setSubmitting(false);
      }
    });
  };

  const switchToCardFromModal = () => {
    const subscriptionId = mmSubscriptionId;
    setMmSubscriptionId(null);
    if (!subscriptionId || !user?.id || !prices) return;

    if (!paymentWidgetPreflight(prices.currencyCode).ok) {
      Alert.alert(t('Paiement indisponible.'), t("Le paiement n'est pas disponible pour le moment. Réessaie plus tard."));
      return;
    }

    void payLock.run(async () => {
      setSubmitting(true);
      try {
        const res = await paySubscriptionWithCard(
          subscriptionId,
          createOpenPaymentWidget({
            amount: selectedAmount,
            currency: prices.currencyCode,
            customerId: user.id,
            customerName: `${user.firstName} ${user.lastName}`.trim(),
            customerEmail: user.email ?? '',
            payItemName: selectedPlan === 'monthly' ? t('Abonnement mensuel') : t('Abonnement annuel'),
          }),
        );
        if (res.status === 'confirmed') {
          await triggerSuccessOnce();
        }
      } catch (e: any) {
        Alert.alert(t('Erreur'), e?.message ?? t('Impossible de démarrer le paiement.'));
      } finally {
        setSubmitting(false);
      }
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        {showBack ? (
          <Pressable onPress={() => router.back()} className="p-1 mr-2" accessibilityRole="button" accessibilityLabel={t('Retour')}>
            <ChevronLeft color={colors.ink} size={26} />
          </Pressable>
        ) : null}
        <Text className="font-sans-bold text-lg text-ink">{t('Abonnement')}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 16, paddingBottom: 32 }}>
        {loading ? (
          <View className="py-12 items-center">
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : !prices ? (
          <View className="items-center pt-4">
            <View className="w-16 h-16 rounded-full bg-accent-50 items-center justify-center mb-5">
              <Lock color={colors.accent} size={28} />
            </View>
            <Text className="font-sans text-base text-ink text-center" style={{ lineHeight: 24 }}>
              {t("L'abonnement sera bientôt disponible dans l'application. Ton accès est limité en attendant.")}
            </Text>
          </View>
        ) : (
          <View className="gap-4">
            {active ? (
              <View className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex-row items-center gap-3">
                <CheckCircle2 color={colors.primary} size={24} />
                <View className="flex-1">
                  <Text className="font-sans-bold text-ink">
                    {active.plan === 'annual' ? t('Abonnement annuel actif') : t('Abonnement mensuel actif')}
                  </Text>
                  {active.expiresAt ? (
                    <Text className="font-sans text-xs text-muted mt-0.5">
                      {t("Valable jusqu'au {date}", {
                        date: new Date(active.expiresAt).toLocaleDateString(appLocale()),
                      })}
                    </Text>
                  ) : null}
                </View>
              </View>
            ) : null}

            <Text className="font-sans-bold text-base text-ink">{t('Choisis ton forfait')}</Text>

            {(['monthly', 'annual'] as const).map((plan) => {
              const price = plan === 'monthly' ? prices.monthly : prices.annual;
              const selected = selectedPlan === plan;
              return (
                <Pressable
                  key={plan}
                  onPress={() => setSelectedPlan(plan)}
                  className={`rounded-2xl border p-4 flex-row items-center justify-between ${
                    selected ? 'bg-emerald-50 border-primary' : 'bg-surface border-line'
                  }`}
                >
                  <View>
                    <Text className="font-sans-bold text-base text-ink">
                      {plan === 'monthly' ? t('Forfait mensuel') : t('Forfait annuel')}
                    </Text>
                    <Text className="font-sans text-xs text-muted mt-0.5">
                      {plan === 'monthly' ? t('Renouvellement 30 jours') : t('Accès complet 12 mois')}
                    </Text>
                  </View>
                  <Text className="font-sans-bold text-base text-primary">{formatMoney(price, country)}</Text>
                </Pressable>
              );
            })}

            {isCdf ? (
              <View className="gap-3 mt-2">
                <Pressable
                  onPress={() => startPayment('mobile_money')}
                  disabled={submitting}
                  className="bg-primary rounded-2xl py-4 px-5 flex-row items-center justify-center gap-2"
                >
                  {submitting ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <>
                      <Smartphone color="#FFFFFF" size={18} />
                      <Text className="font-sans-bold text-white text-base">
                        {t('Payer par Mobile Money')}
                      </Text>
                    </>
                  )}
                </Pressable>

                <Pressable
                  onPress={() => startPayment('card')}
                  disabled={submitting}
                  className="bg-surface border border-line rounded-2xl py-3.5 px-5 flex-row items-center justify-center gap-2"
                >
                  <CreditCard color={colors.ink} size={18} />
                  <Text className="font-sans-bold text-ink text-sm">{t('Payer par carte bancaire')}</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => startPayment('card')}
                disabled={submitting}
                className="bg-primary rounded-2xl py-4 px-5 flex-row items-center justify-center gap-2 mt-2"
              >
                {submitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <CreditCard color="#FFFFFF" size={18} />
                    <Text className="font-sans-bold text-white text-base">{t('Payer par carte bancaire')}</Text>
                  </>
                )}
              </Pressable>
            )}
          </View>
        )}

        {showLogout ? (
          <Pressable onPress={onLogout} className="py-4 items-center mt-6" accessibilityRole="button">
            <Text className="font-sans-bold text-muted">{t('Se déconnecter')}</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <MobileMoneyModal
        visible={mmSubscriptionId !== null}
        target={mmSubscriptionId ? { kind: 'subscription', subscriptionId: mmSubscriptionId } : null}
        userPhone={user?.phone}
        amountLabel={amountLabel}
        onClose={() => setMmSubscriptionId(null)}
        onPaid={async () => {
          setMmSubscriptionId(null);
          await triggerSuccessOnce();
        }}
        onSwitchToCard={switchToCardFromModal}
      />
    </SafeAreaView>
  );
}
