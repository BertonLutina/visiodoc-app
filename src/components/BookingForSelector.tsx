import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Baby, User as UserIcon } from 'lucide-react-native';
import { Field } from '@/components/ui';
import { colors } from '@/theme/colors';
import {
  calculateChildAge,
  measurementAgeText,
  measurementPlausibilityWarning,
  parseMeasurementInput,
} from '@/services/childrenApi';
import type { BookingFor } from '@/utils/bookingFor';
import type { ChildMeasurements, PatientChild } from '@/types/children';
import { useT } from '@/i18n';

type Props = {
  providerAcceptsChildren: boolean;
  bookingFor: BookingFor;
  onChangeBookingFor: (v: BookingFor) => void;
  children: PatientChild[];
  selectedChildId: string | null;
  onSelectChild: (id: string) => void;
  measurements: ChildMeasurements | null;
  weight: string;
  height: string;
  onChangeWeight: (v: string) => void;
  onChangeHeight: (v: string) => void;
};

/** « Pour moi / Pour mon enfant » (MOB-1311-1 §3 et §4). « Pour mon enfant » est désactivé si le prestataire n'accepte pas les enfants. */
export function BookingForSelector(p: Props) {
  const t = useT();
  const child = p.children.find((c) => c.id === p.selectedChildId) ?? null;
  const w = parseMeasurementInput(p.weight);
  const h = parseMeasurementInput(p.height);
  const warning =
    p.bookingFor === 'child'
      ? measurementPlausibilityWarning(
          child ? calculateChildAge(child.dateOfBirth) : null,
          w !== null && !Number.isNaN(w) ? w : null,
          h !== null && !Number.isNaN(h) ? h : null,
        )
      : null;

  const option = (key: BookingFor, label: string, Icon: typeof UserIcon, disabled: boolean) => {
    const on = p.bookingFor === key;
    return (
      <Pressable
        key={key}
        disabled={disabled}
        onPress={() => p.onChangeBookingFor(key)}
        accessibilityRole="radio"
        accessibilityState={{ selected: on, disabled }}
        className={`flex-1 items-center py-4 rounded-3xl mx-1 ${disabled ? 'bg-line' : on ? 'bg-primary' : 'bg-surface border border-line'}`}
      >
        <Icon color={disabled ? colors.muted : on ? colors.white : colors.primary} size={22} />
        <Text className={`text-sm mt-1 font-sans-semibold ${disabled ? 'text-muted' : on ? 'text-white' : 'text-ink'}`}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <View className="mb-6">
      <View className="flex-row justify-between">
        {option('self', t('Pour moi'), UserIcon, false)}
        {option('child', t('Pour mon enfant'), Baby, !p.providerAcceptsChildren)}
      </View>
      {!p.providerAcceptsChildren ? (
        <Text className="font-sans text-xs text-clay mt-2">{t("Ce professionnel n'accepte pas les consultations pour des enfants.")}</Text>
      ) : null}

      {p.bookingFor === 'child' && p.providerAcceptsChildren ? (
        <View className="mt-4">
          <Text className="font-sans-semibold text-sm text-ink mb-2">{t("Choisissez l'enfant concerné")}</Text>
          {p.children.length === 0 ? (
            <Text className="font-sans text-sm text-muted mb-2">{t("Aucun enfant enregistré pour l'instant.")}</Text>
          ) : (
            p.children.map((c) => {
              const on = c.id === p.selectedChildId;
              const age = calculateChildAge(c.dateOfBirth);
              return (
                <Pressable
                  key={c.id}
                  onPress={() => p.onSelectChild(c.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  className={`rounded-2xl px-4 py-3 mb-2 ${on ? 'bg-primary' : 'bg-surface border border-line'}`}
                >
                  <Text className={`font-sans-bold ${on ? 'text-white' : 'text-ink'}`}>
                    {c.firstName} {c.lastName}
                  </Text>
                  <Text className={`font-sans text-xs ${on ? 'text-white' : 'text-muted'}`}>
                    {age !== null ? `${age} ${t('ans')}` : t('Âge inconnu')}
                  </Text>
                </Pressable>
              );
            })
          )}
          <Pressable onPress={() => router.push('/children/add')} className="self-start mb-3">
            <Text className="font-sans-semibold text-sm text-primary underline">{t('Ajouter un enfant')}</Text>
          </Pressable>

          {child ? (
            <View className="bg-surface border border-line rounded-3xl p-4">
              <Text className="font-sans-semibold text-sm text-ink mb-1">{t('Mesures actuelles (facultatives)')}</Text>
              {p.measurements?.measuredAt ? (
                <Text className="font-sans text-xs text-muted mb-2">{measurementAgeText(p.measurements.measuredAt)}</Text>
              ) : null}
              <Field label={t('Poids (kg), facultatif')} value={p.weight} onChangeText={p.onChangeWeight} keyboardType="decimal-pad" />
              <Field label={t('Taille (cm), facultatif')} value={p.height} onChangeText={p.onChangeHeight} keyboardType="decimal-pad" />
              {warning ? <Text className="font-sans text-xs text-amber-700">{warning}</Text> : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
