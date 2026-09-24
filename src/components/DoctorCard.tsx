import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Avatar } from '@/components/ui';
import { formatMoney } from '@/utils/format';
import { colors } from '@/theme/colors';
import type { Doctor } from '@/types';

export function DoctorCard({ doctor, onPress }: { doctor: Doctor; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center bg-surface rounded-3xl border border-line p-3.5 mb-3"
    >
      <Avatar initials={doctor.initials} />
      <View className="flex-1 ml-3.5">
        <Text className="font-sans-bold text-base text-ink">
          Dr. {doctor.firstName} {doctor.lastName}
        </Text>
        <Text className="font-sans text-sm text-muted mt-0.5">
          {doctor.specialty} · {doctor.city}
        </Text>
        <Text className="text-xs mt-1 font-sans-semibold" style={{ color: colors.star }}>
          ★ {doctor.rating.toFixed(1)}
          <Text className="font-sans text-muted"> · {doctor.availabilityLabel}</Text>
        </Text>
      </View>
      <View className="items-end">
        <Text className="font-serif-bold text-base text-primary">{formatMoney(doctor.fee)}</Text>
      </View>
    </Pressable>
  );
}
