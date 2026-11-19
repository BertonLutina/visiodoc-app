import React, { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { noShowAvailableAt, noShowButtonState } from '@/utils/noShowAvailableAt';
import { useT } from '@/i18n';

type Props = {
  visible: boolean;
  scheduledAt: string | null;
  startedAt: string | null;
  /** Crochet : non nul = le patient a rejoint (donnée pas encore fournie par le backend, passer null). */
  patientJoinedAt?: string | null;
  onEnd: () => void;
  onAbsent: () => void;
  onLater: () => void;
};

const REFRESH_MS = 20_000;

/** Choix du prestataire en quittant l'appel. « Le patient est absent » est grisé tant que l'attente minimale court. */
export function CallOutcomeModal({ visible, scheduledAt, startedAt, patientJoinedAt = null, onEnd, onAbsent, onLater }: Props) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), REFRESH_MS);
    return () => clearInterval(id);
  }, [visible]);

  const state = noShowButtonState({ availableAt: noShowAvailableAt(scheduledAt, startedAt), now, patientJoinedAt });
  const hint = state.enabled
    ? null
    : state.reason === 'joined'
      ? t('Le patient a rejoint la consultation')
      : t('Disponible dans {n} min', { n: state.minutes });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => {}}>
      <View className="flex-1 items-center justify-center bg-black/60 px-6">
        <View className="w-full rounded-2xl bg-white p-5">
          <Text className="font-serif-bold text-xl text-ink">{t("Fin de l'appel")}</Text>
          <Text className="mt-1 mb-4 text-ink/70">{t('Que veux-tu faire de cette consultation ?')}</Text>

          <Pressable
            onPress={onEnd}
            accessibilityRole="button"
            className="mb-2 items-center rounded-xl bg-accent py-3 active:opacity-80"
          >
            <Text className="font-semibold text-white">{t('Terminer la consultation')}</Text>
          </Pressable>

          <Pressable
            onPress={state.enabled ? onAbsent : undefined}
            disabled={!state.enabled}
            accessibilityRole="button"
            accessibilityState={{ disabled: !state.enabled }}
            className={`mb-2 items-center rounded-xl border py-3 ${
              state.enabled ? 'border-accent active:opacity-80' : 'border-gray-200 bg-gray-100'
            }`}
          >
            <Text className={`font-semibold ${state.enabled ? 'text-accent' : 'text-gray-400'}`}>
              {t('Le patient est absent')}
            </Text>
            {hint ? <Text className="mt-0.5 text-xs text-gray-500">{hint}</Text> : null}
          </Pressable>

          <Pressable onPress={onLater} accessibilityRole="button" className="items-center rounded-xl py-3 active:opacity-70">
            <Text className="font-semibold text-ink">{t('Revenir plus tard')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
