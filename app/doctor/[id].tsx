import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Video, MessageCircle, Phone, CalendarX } from 'lucide-react-native';
import { Avatar, Button, SectionTitle, Stars } from '@/components/ui';
import { formatMoney } from '@/utils/format';
import { activeCountry } from '@/config/countries';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { bookConsultation, getDoctor } from '@/services/patientApi';
import { getAvailability } from '@/services/providerApi';
import { generateBookableDays } from '@/utils/availability';
import { doctors } from '@/data/mock';
import type { ConsultationType } from '@/types';

const types: { key: ConsultationType; icon: typeof Video; label: string }[] = [
  { key: 'video', icon: Video, label: 'Vidéo' },
  { key: 'chat', icon: MessageCircle, label: 'Chat' },
  { key: 'phone', icon: Phone, label: 'Tél.' },
];

export default function DoctorProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { data: fetched } = useAsync(() => getDoctor(id), [id]);
  const doctor = fetched ?? doctors.find((d) => d.id === id) ?? doctors[0];

  const { data: availability } = useAsync(() => getAvailability(doctor.id), [doctor.id]);
  const days = useMemo(() => generateBookableDays(availability ?? []), [availability]);

  const [dayKey, setDayKey] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [type, setType] = useState<ConsultationType>('video');
  const [booking, setBooking] = useState(false);

  const activeDay = days.find((d) => d.key === dayKey) ?? days[0];

  const onBook = async () => {
    if (!activeDay || !time) return;
    setBooking(true);
    try {
      const [h, m] = time.split(':').map(Number);
      const dt = new Date(activeDay.date);
      dt.setHours(h, m, 0, 0);
      await bookConsultation({
        patientId: user?.id ?? 'patient-1',
        doctorId: doctor.id,
        scheduledAt: dt.toISOString(),
        type,
        fee: doctor.fee,
      });
      router.replace('/(patient)/appointments');
    } catch (e: any) {
      Alert.alert('Réservation impossible', e?.message ?? 'Réessayez plus tard.');
    } finally {
      setBooking(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2">
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">Profil médecin</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
        <View className="items-center mb-6">
          <Avatar initials={doctor.initials} size={80} />
          <Text className="font-serif-bold text-2xl text-ink mt-3">
            Dr. {doctor.firstName} {doctor.lastName}
          </Text>
          <Text className="font-sans text-sm text-muted mt-0.5">
            {doctor.specialty} · {doctor.city}
          </Text>
          <View className="mt-2">
            <Stars rating={doctor.rating} />
          </View>
          <Text className="font-sans text-xs text-muted mt-1">{doctor.reviewsCount} avis</Text>
        </View>

        {/* Stats */}
        <View className="flex-row justify-between mb-6">
          {[
            { v: `${doctor.yearsOfExperience} ans`, l: 'Expérience' },
            { v: `${doctor.patientsCount}`, l: 'Patients' },
            { v: `${Math.round(doctor.fee / 1000)}k ${activeCountry.currency.symbol}`, l: 'Tarif' },
          ].map((s) => (
            <View key={s.l} className="flex-1 items-center bg-surface border border-line rounded-3xl py-4 mx-1">
              <Text className="font-serif-bold text-xl text-ink">{s.v}</Text>
              <Text className="font-sans text-xs text-muted mt-0.5">{s.l}</Text>
            </View>
          ))}
        </View>

        {/* Disponibilités */}
        <SectionTitle>Choisir un créneau</SectionTitle>
        {days.length === 0 ? (
          <View className="bg-surface border border-line rounded-3xl p-6 items-center mb-4">
            <View className="w-12 h-12 rounded-2xl bg-sand items-center justify-center mb-3">
              <CalendarX color={colors.clay} size={22} />
            </View>
            <Text className="font-sans-semibold text-ink text-center">
              Aucune disponibilité publiée
            </Text>
            <Text className="font-sans text-sm text-muted text-center mt-1">
              Ce médecin n'a pas encore ouvert de créneaux. Réessayez plus tard.
            </Text>
          </View>
        ) : (
          <>
            {/* Jours */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4 -mx-1">
              {days.map((d) => {
                const on = (activeDay?.key ?? '') === d.key;
                return (
                  <Pressable
                    key={d.key}
                    onPress={() => {
                      setDayKey(d.key);
                      setTime(null);
                    }}
                    className={`px-4 py-3 rounded-2xl mx-1 items-center ${on ? 'bg-primary' : 'bg-surface border border-line'}`}
                  >
                    <Text className={`font-sans-medium text-xs ${on ? 'text-white/80' : 'text-muted'}`}>
                      {d.weekdayLong.slice(0, 3)}
                    </Text>
                    <Text className={`font-serif-bold text-lg ${on ? 'text-white' : 'text-ink'}`}>
                      {d.date.getDate()}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Créneaux horaires du jour sélectionné */}
            <View className="flex-row flex-wrap mb-4">
              {(activeDay?.times ?? []).map((t) => {
                const on = time === t;
                return (
                  <Pressable
                    key={t}
                    onPress={() => setTime(t)}
                    className={`w-[31%] mr-[2.33%] py-3 rounded-2xl items-center mb-2 ${on ? 'bg-primary' : 'bg-surface border border-line'}`}
                  >
                    <Text className={`font-sans-bold ${on ? 'text-white' : 'text-ink'}`}>{t}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        {/* Type */}
        <SectionTitle>Type de consultation</SectionTitle>
        <View className="flex-row justify-between mb-6">
          {types.map((t) => {
            const on = type === t.key;
            return (
              <Pressable
                key={t.key}
                onPress={() => setType(t.key)}
                className={`flex-1 items-center py-4 rounded-3xl mx-1 ${on ? 'bg-primary' : 'bg-surface border border-line'}`}
              >
                <t.icon color={on ? colors.white : colors.primary} size={22} />
                <Text className={`text-sm mt-1 font-sans-semibold ${on ? 'text-white' : 'text-ink'}`}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Button
          label={
            activeDay && time
              ? `Réserver ${activeDay.weekdayLong} ${activeDay.date.getDate()} à ${time} — ${formatMoney(doctor.fee)}`
              : `Réserver — ${formatMoney(doctor.fee)}`
          }
          disabled={!time || !activeDay}
          loading={booking}
          onPress={onBook}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
