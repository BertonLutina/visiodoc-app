import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Video, MessageCircle, Phone, CalendarX } from 'lucide-react-native';
import { Avatar, Button, SectionTitle, Stars } from '@/components/ui';
import { MonthCalendar } from '@/components/MonthCalendar';
import { formatMoney } from '@/utils/format';
import { getCountry } from '@/config/countries';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { bookConsultation, getDoctor, PaymentInitiationError, SlotUnavailableError } from '@/services/patientApi';
import { getDaySlots, getMonthAvailability } from '@/services/availabilityApi';
import { doctors } from '@/data/mock';
import { appLocale } from '@/i18n';
import type { ConsultationType } from '@/types';
import { useT } from '@/i18n';

const types: { key: ConsultationType; icon: typeof Video; label: string }[] = [
  { key: 'video', icon: Video, label: 'Vidéo' },
  { key: 'chat', icon: MessageCircle, label: 'Chat' },
  { key: 'phone', icon: Phone, label: 'Tél.' },
];

const timeLabel = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export default function DoctorProfile() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const country = getCountry(user?.countryCode ?? 'CD');
  const { data: fetched } = useAsync(() => getDoctor(id), [id]);
  const doctor = fetched ?? doctors.find((d) => d.id === id) ?? doctors[0];

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [type, setType] = useState<ConsultationType>('video');
  const [booking, setBooking] = useState(false);

  const {
    data: monthStatus,
    loading: monthLoading,
    error: monthError,
    reload: reloadMonth,
  } = useAsync(() => getMonthAvailability(doctor.id, year, month), [doctor.id, year, month]);

  const {
    data: daySlots,
    loading: dayLoading,
    error: dayError,
    reload: reloadDay,
  } = useAsync(
    () => (selectedDate ? getDaySlots(doctor.id, new Date(selectedDate + 'T00:00:00')) : Promise.resolve([])),
    [doctor.id, selectedDate],
  );

  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + 3650); // le vrai horizon vient du statut jour-par-jour

  const activeSlot = (daySlots ?? []).find((s) => timeLabel(s.start) === time) ?? null;

  const onBook = async () => {
    if (!activeSlot) return;
    setBooking(true);
    try {
      const { paymentIntent } = await bookConsultation({
        patientId: user?.id ?? 'patient-1',
        doctorId: doctor.id,
        scheduledAt: activeSlot.start.toISOString(),
        duration: Math.round((activeSlot.end.getTime() - activeSlot.start.getTime()) / 60000),
        type,
        fee: doctor.fee,
        countryCode: user?.countryCode,
        customerEmail: user?.email,
        customerName: user ? `${user.firstName} ${user.lastName}` : undefined,
      });
      if (paymentIntent) {
        router.replace({ pathname: '/payment', params: { intent: JSON.stringify(paymentIntent) } });
      } else {
        router.replace('/(patient)/appointments');
      }
    } catch (e: any) {
      if (e instanceof SlotUnavailableError) {
        Alert.alert(t('Créneau indisponible'), e.message);
        setTime(null);
        reloadDay();
        reloadMonth();
      } else if (e instanceof PaymentInitiationError) {
        Alert.alert(t('Paiement non démarré'), e.message);
        router.replace('/(patient)/appointments');
      } else {
        Alert.alert(t('Réservation impossible'), e?.message ?? t('Réessayez plus tard.'));
      }
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
        <Text className="font-sans-bold text-lg text-ink">{t('Profil médecin')}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
        <View className="items-center mb-6">
          <Avatar initials={doctor.initials} size={80} uri={doctor.avatarUrl} />
          <Text className="font-serif-bold text-2xl text-ink mt-3">
            Dr. {doctor.firstName} {doctor.lastName}
          </Text>
          <Text className="font-sans text-sm text-muted mt-0.5">
            {t(doctor.specialty)} · {doctor.city}
          </Text>
          <View className="mt-2">
            <Stars rating={doctor.rating} />
          </View>
          <Text className="font-sans text-xs text-muted mt-1">{doctor.reviewsCount} {t('avis')}</Text>
        </View>

        <View className="flex-row justify-between mb-6">
          {[
            { v: `${doctor.yearsOfExperience} ${t('ans')}`, l: t('Expérience') },
            { v: `${doctor.patientsCount}`, l: t('Patients') },
            { v: `${Math.round(doctor.fee / 1000)}k ${country.currency.symbol}`, l: t('Tarif') },
          ].map((s) => (
            <View key={s.l} className="flex-1 items-center bg-surface border border-line rounded-3xl py-4 mx-1">
              <Text className="font-serif-bold text-xl text-ink">{s.v}</Text>
              <Text className="font-sans text-xs text-muted mt-0.5">{s.l}</Text>
            </View>
          ))}
        </View>

        <SectionTitle>{t('Choisir un créneau')}</SectionTitle>
        {monthError ? (
          <View className="bg-sand rounded-2xl px-4 py-4 items-center mb-4">
            <Text className="font-sans-medium text-sm text-clay text-center mb-3">
              {t('Impossible de charger le calendrier.')} {monthError}
            </Text>
            <Button label={t('Réessayer')} variant="outline" onPress={reloadMonth} />
          </View>
        ) : !monthLoading && Object.keys(monthStatus ?? {}).length > 0 && Object.values(monthStatus ?? {}).every((s) => s === 'unavailable') ? (
          <View className="bg-surface border border-line rounded-3xl p-6 items-center mb-4">
            <View className="w-12 h-12 rounded-2xl bg-sand items-center justify-center mb-3">
              <CalendarX color={colors.clay} size={22} />
            </View>
            <Text className="font-sans-semibold text-ink text-center">{t('Aucune disponibilité ce mois-ci')}</Text>
          </View>
        ) : null}
        <MonthCalendar
          year={year}
          month={month}
          monthStatus={monthStatus ?? {}}
          selectedDate={selectedDate}
          onSelectDate={(key) => {
            setSelectedDate(key);
            setTime(null);
          }}
          onChangeMonth={(y, m) => {
            setYear(y);
            setMonth(m);
            setSelectedDate(null);
            setTime(null);
          }}
          minDate={today}
          maxDate={maxDate}
          loading={monthLoading}
        />

        {selectedDate ? (
          <View className="mt-4 mb-4">
            <Text className="font-sans-bold text-ink mb-3">
              {new Date(selectedDate + 'T00:00:00').toLocaleDateString(appLocale(), {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </Text>
            {dayLoading ? (
              <Text className="font-sans text-muted">{t('Chargement des créneaux…')}</Text>
            ) : dayError ? (
              <View className="bg-sand rounded-2xl px-4 py-4 items-center">
                <Text className="font-sans-medium text-sm text-clay text-center mb-3">
                  {t('Impossible de charger les créneaux.')} {dayError}
                </Text>
                <Button label={t('Réessayer')} variant="outline" onPress={reloadDay} />
              </View>
            ) : (daySlots ?? []).length === 0 ? (
              <View className="bg-surface border border-line rounded-3xl p-6 items-center">
                <View className="w-12 h-12 rounded-2xl bg-sand items-center justify-center mb-3">
                  <CalendarX color={colors.clay} size={22} />
                </View>
                <Text className="font-sans-semibold text-ink text-center">{t('Aucun créneau ce jour-là')}</Text>
              </View>
            ) : (
              <View className="flex-row flex-wrap">
                {(daySlots ?? []).map((s) => {
                  const label = timeLabel(s.start);
                  const on = time === label;
                  return (
                    <Pressable
                      key={label}
                      disabled={!s.available}
                      onPress={() => setTime(label)}
                      className={`w-[31%] mr-[2.33%] py-3 rounded-2xl items-center mb-2 ${
                        !s.available ? 'bg-line' : on ? 'bg-primary' : 'bg-surface border border-line'
                      }`}
                    >
                      <Text
                        className={`font-sans-bold ${
                          !s.available ? 'text-muted' : on ? 'text-white' : 'text-ink'
                        }`}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        ) : null}

        <SectionTitle>{t('Type de consultation')}</SectionTitle>
        <View className="flex-row justify-between mb-6">
          {types.map((ty) => {
            const on = type === ty.key;
            return (
              <Pressable
                key={ty.key}
                onPress={() => setType(ty.key)}
                className={`flex-1 items-center py-4 rounded-3xl mx-1 ${on ? 'bg-primary' : 'bg-surface border border-line'}`}
              >
                <ty.icon color={on ? colors.white : colors.primary} size={22} />
                <Text className={`text-sm mt-1 font-sans-semibold ${on ? 'text-white' : 'text-ink'}`}>{t(ty.label)}</Text>
              </Pressable>
            );
          })}
        </View>

        <Button
          label={
            activeSlot && selectedDate
              ? t('Réserver {date} à {time} — {price}', {
                  date: new Date(selectedDate + 'T00:00:00').toLocaleDateString(appLocale(), { weekday: 'long', day: 'numeric' }),
                  time: timeLabel(activeSlot.start),
                  price: formatMoney(doctor.fee, country),
                })
              : t('Réserver — {price}', { price: formatMoney(doctor.fee, country) })
          }
          disabled={!activeSlot}
          loading={booking}
          onPress={onBook}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
