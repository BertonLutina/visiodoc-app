import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { CheckCircle2, Phone, RefreshCw, X } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { useT } from '@/i18n';
import {
  MOBILE_WALLET_PROVIDERS,
  OPERATOR_LABELS,
  detectLocalOperator,
  initiateMobileMoneyPayment,
  resolveMobileMoneyPrefillPhone,
  startMobileMoneyStatusPolling,
  type MobileMoneyTarget,
  type MobileWalletProvider,
} from '@/services/mobileMoney';

type ModalPhase = 'input' | 'waiting' | 'expired' | 'failed' | 'review';

interface MobileMoneyModalProps {
  visible: boolean;
  target: MobileMoneyTarget | null;
  userPhone?: string | null;
  amountLabel?: string;
  onClose: () => void;
  onPaid: (txnRef: string) => void;
  onSwitchToCard?: () => void;
}

export function MobileMoneyModal({
  visible,
  target,
  userPhone,
  amountLabel,
  onClose,
  onPaid,
  onSwitchToCard,
}: MobileMoneyModalProps) {
  const t = useT();
  const [phase, setPhase] = useState<ModalPhase>('input');
  const [phone, setPhone] = useState(() => resolveMobileMoneyPrefillPhone(userPhone));
  const [operator, setOperator] = useState<MobileWalletProvider | null>(() =>
    detectLocalOperator(resolveMobileMoneyPrefillPhone(userPhone)),
  );
  const [showOperators, setShowOperators] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [warningMsg, setWarningMsg] = useState<string | null>(null);
  const [txnRef, setTxnRef] = useState<string | null>(null);

  const hasEditedRef = useRef(false);
  const pollerRef = useRef<{ stop: () => void } | null>(null);
  const successHandledRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      pollerRef.current?.stop();
      pollerRef.current = null;
      return;
    }
    hasEditedRef.current = false;
    successHandledRef.current = false;
    const prefilled = resolveMobileMoneyPrefillPhone(userPhone);
    setPhone(prefilled);
    setOperator(detectLocalOperator(prefilled));
    setPhase('input');
    setShowOperators(false);
    setErrorMsg(null);
    setWarningMsg(null);
    setTxnRef(null);
  }, [visible, userPhone]);

  useEffect(() => {
    return () => {
      pollerRef.current?.stop();
      pollerRef.current = null;
    };
  }, []);

  const handlePhoneChange = (val: string) => {
    hasEditedRef.current = true;
    setPhone(val);
    setErrorMsg(null);
    const detected = detectLocalOperator(val);
    if (detected) setOperator(detected);
  };

  const startPolling = (ref: string) => {
    pollerRef.current?.stop();
    pollerRef.current = startMobileMoneyStatusPolling({
      txnRef: ref,
      onPaid: (paidRef) => {
        if (successHandledRef.current) return;
        successHandledRef.current = true;
        onPaid(paidRef);
      },
      onTerminal: (terminalState) => {
        if (terminalState === 'expired') setPhase('expired');
        else if (terminalState === 'failed') setPhase('failed');
        else if (terminalState === 'review') setPhase('review');
      },
    });
  };

  const handleSubmit = async () => {
    if (!target || submitting) return;
    setErrorMsg(null);
    setWarningMsg(null);
    setSubmitting(true);

    const res = await initiateMobileMoneyPayment({
      target,
      phone,
      operator: operator ?? undefined,
    });

    setSubmitting(false);

    if (res.success && (res.alreadyPaid || res.nothingToPay)) {
      if (!successHandledRef.current) {
        successHandledRef.current = true;
        onPaid(res.txnRef ?? '');
      }
      return;
    }

    if (res.success && res.txnRef) {
      setTxnRef(res.txnRef);
      if (res.operator) setOperator(res.operator);
      setPhase('waiting');
      startPolling(res.txnRef);
      return;
    }

    if (res.operatorRequired) {
      setShowOperators(true);
    }
    if (res.providerUnreachable) {
      setWarningMsg(res.error ?? null);
    } else {
      setErrorMsg(res.error ?? t("Impossible d'initier la demande Mobile Money. Réessaie."));
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/50">
        <View className="bg-bg rounded-t-3xl px-5 pt-5 pb-8 max-h-[90%]">
          <View className="flex-row items-center justify-between mb-4">
            <Text className="font-sans-bold text-lg text-ink">
              {t('Paiement Mobile Money')}
            </Text>
            <Pressable onPress={onClose} className="p-1" accessibilityRole="button" accessibilityLabel={t('Fermer')}>
              <X color={colors.muted} size={22} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled">
            {amountLabel ? (
              <View className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 mb-4">
                <Text className="font-sans-bold text-base text-emerald-800">{amountLabel}</Text>
              </View>
            ) : null}

            {phase === 'input' ? (
              <>
                <Text className="font-sans text-sm text-muted mb-2">
                  {t('Numéro Mobile Money (RDC)')}
                </Text>
                <View className="flex-row items-center border border-slate-300 rounded-xl bg-white px-3 mb-3">
                  <View className="flex-row items-center pr-3 mr-3 border-r border-slate-200 py-3">
                    <Phone color={colors.accent} size={16} />
                    <Text className="font-sans-bold text-sm text-ink ml-1.5">+243</Text>
                  </View>
                  <TextInput
                    value={phone}
                    onChangeText={handlePhoneChange}
                    placeholder="0854298797"
                    keyboardType="phone-pad"
                    className="flex-1 py-3 font-sans text-base text-ink"
                    accessibilityLabel={t('Numéro Mobile Money (RDC)')}
                  />
                </View>

                {(showOperators || operator) ? (
                  <View className="mb-4">
                    <Text className="font-sans-semibold text-xs text-muted mb-2">
                      {t('Opérateur Mobile Money')}
                    </Text>
                    <View className="flex-row flex-wrap gap-2">
                      {MOBILE_WALLET_PROVIDERS.map((op) => {
                        const selected = operator === op;
                        return (
                          <Pressable
                            key={op}
                            onPress={() => setOperator(op)}
                            className={`px-3 py-2 rounded-lg border ${
                              selected ? 'bg-emerald-50 border-emerald-600' : 'bg-white border-slate-200'
                            }`}
                          >
                            <Text
                              className={`font-sans-semibold text-xs ${
                                selected ? 'text-emerald-800' : 'text-ink'
                              }`}
                            >
                              {OPERATOR_LABELS[op]}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ) : null}

                {errorMsg ? (
                  <View className="bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5 mb-3">
                    <Text className="font-sans text-sm text-red-700">{errorMsg}</Text>
                  </View>
                ) : null}

                {warningMsg ? (
                  <View className="bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5 mb-3">
                    <Text className="font-sans text-sm text-amber-800">{warningMsg}</Text>
                  </View>
                ) : null}

                <Pressable
                  onPress={handleSubmit}
                  disabled={submitting}
                  className="bg-emerald-600 rounded-xl py-3.5 items-center mb-3"
                >
                  {submitting ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text className="font-sans-bold text-base text-white">
                      {t('Valider le paiement')}
                    </Text>
                  )}
                </Pressable>

                {onSwitchToCard ? (
                  <Pressable onPress={onSwitchToCard} className="py-2.5 items-center">
                    <Text className="font-sans-semibold text-sm text-accent">
                      {t('Payer par carte bancaire')}
                    </Text>
                  </Pressable>
                ) : null}
              </>
            ) : phase === 'waiting' ? (
              <View className="items-center py-6">
                <ActivityIndicator size="large" color={colors.accent} />
                <Text className="font-sans-bold text-base text-ink text-center mt-4 mb-2">
                  {t('Validez la demande sur votre téléphone maintenant')}
                </Text>
                <Text className="font-sans text-sm text-muted text-center">
                  {t('Vérification automatique en cours...')}
                </Text>
              </View>
            ) : phase === 'expired' ? (
              <View className="items-center py-5">
                <Text className="font-sans-bold text-base text-ink text-center mb-2">
                  {t('Délai dépassé')}
                </Text>
                <Text className="font-sans text-sm text-muted text-center mb-5">
                  {t("La demande a expiré ou n'a pas été confirmée à temps.")}
                </Text>
                <Pressable
                  onPress={() => setPhase('input')}
                  className="bg-emerald-600 rounded-xl px-6 py-3 flex-row items-center"
                >
                  <RefreshCw color="#ffffff" size={16} />
                  <Text className="font-sans-bold text-sm text-white ml-2">
                    {t('Renvoyer la demande')}
                  </Text>
                </Pressable>
              </View>
            ) : phase === 'failed' ? (
              <View className="items-center py-5">
                <Text className="font-sans-bold text-base text-red-700 text-center mb-2">
                  {t('Paiement refusé')}
                </Text>
                <Text className="font-sans text-sm text-muted text-center mb-5">
                  {t('Le paiement Mobile Money a été refusé ou annulé.')}
                </Text>
                <Pressable
                  onPress={() => setPhase('input')}
                  className="bg-emerald-600 rounded-xl px-6 py-3"
                >
                  <Text className="font-sans-bold text-sm text-white">
                    {t('Réessayer')}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View className="items-center py-5">
                <CheckCircle2 color={colors.accent} size={36} />
                <Text className="font-sans-bold text-base text-ink text-center mt-3 mb-2">
                  {t('Vérification en cours')}
                </Text>
                <Text className="font-sans text-sm text-muted text-center mb-4">
                  {t("Ne paie pas une seconde fois : ton paiement est en cours de vérification.")}
                </Text>
                {txnRef ? (
                  <Text className="font-sans text-xs text-muted">{txnRef}</Text>
                ) : null}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
