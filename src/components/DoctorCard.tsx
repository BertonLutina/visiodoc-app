import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Avatar } from '@/components/ui';
import { formatDoctorFee } from '@/utils/format';
import { shouldHideCommercialInfo } from '@/services/patientApi';
import { colors } from '@/theme/colors';
import type { CountryConfig } from '@/config/countries';
import type { Doctor } from '@/types';
import { useT } from '@/i18n';

export function DoctorCard({
  doctor,
  onPress,
  country,
  signedIn = false,
}: {
  doctor: Doctor;
  onPress?: () => void;
  /** Pays dont la devise doit être utilisée pour afficher le tarif (défaut : pays actif de l'app). */
  country?: CountryConfig;
  /** Session active ? Sans session (ou sans tarif), le tarif n'est pas affiché. */
  signedIn?: boolean;
}) {
  const t = useT();
  const feeText = shouldHideCommercialInfo(doctor.fee, signedIn)
    ? null
    : formatDoctorFee(doctor.fee, doctor.currencyCode, country);
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center bg-surface rounded-3xl border border-line p-3.5 mb-3"
    >
      <Avatar initials={doctor.initials} uri={doctor.avatarUrl} />
      <View className="flex-1 ml-3.5">
        <Text className="font-sans-bold text-base text-ink">
          Dr. {doctor.firstName} {doctor.lastName}
        </Text>
        <Text className="font-sans text-sm text-muted mt-0.5">
          {t(doctor.specialty)} · {doctor.city}
        </Text>
        <Text className="text-xs mt-1 font-sans-semibold" style={{ color: colors.star }}>
          ★ {doctor.rating.toFixed(1)}
          {signedIn && doctor.availabilityLabel ? (
            <Text className="font-sans text-muted"> · {t(doctor.availabilityLabel)}</Text>
          ) : null}
        </Text>
      </View>
      {feeText ? (
        <View className="items-end">
          <Text className="font-serif-bold text-base text-primary">{feeText}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
