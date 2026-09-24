import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Clock, Plus, Trash2, X } from 'lucide-react-native';
import { Modal } from 'react-native';
import { Button, Card } from '@/components/ui';
import { AvailabilityTabs } from '@/components/AvailabilityTabs';
import { MonthCalendar } from '@/components/MonthCalendar';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { currentProvider } from '@/data/mockProvider';
import { useAsync } from '@/hooks/useAsync';
import {
  getOverrides,
  saveOverride,
  deleteOverride,
  type OverrideInput,
} from '@/services/providerApi';
import { TIME_OPTIONS, toMinutes } from '@/utils/availability';
import type { DayStatus } from '@/services/availabilityEngine';

type Range = { start: string; end: string };

export default function AvailabilityOverrides() {
  const { user } = useAuth();
  const uid = user?.id ?? currentProvider.id;
  const today = new Date();

  const { data: overrides, loading, reload } = useAsync(() => getOverrides(uid), [uid]);

  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [unavailableAllDay, setUnavailableAllDay] = useState(false);
  const [ranges, setRanges] = useState<Range[]>([{ start: '09:00', end: '17:00' }]);
  const [picking, setPicking] = useState<{ range: number; which: 'start' | 'end' } | null>(null);
  const [saving, setSaving] = useState(false);

  const monthStatus: Record<string, DayStatus> = useMemo(() => {
    const m: Record<string, DayStatus> = {};
    for (const o of overrides ?? []) {
      m[o.date] = o.isAvailable ? 'available' : 'unavailable';
    }
    return m;
  }, [overrides]);

  const maxDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3650);
    return d;
  }, []);

  const onSelectDate = (key: string) => {
    setSelectedDate(key);
    const existing = (overrides ?? []).find((o) => o.date === key);
    if (existing) {
      setUnavailableAllDay(!existing.isAvailable);
      setRanges(existing.isAvailable && existing.ranges.length ? existing.ranges.map((r) => ({ start: r.startTime, end: r.endTime })) : [{ start: '09:00', end: '17:00' }]);
    } else {
      setUnavailableAllDay(false);
      setRanges([{ start: '09:00', end: '17:00' }]);
    }
  };

  const addRange = () => setRanges((r) => [...r, { start: '14:00', end: '17:00' }]);
  const removeRange = (i: number) => setRanges((r) => r.filter((_, ri) => ri !== i));
  const setRange = (i: number, patch: Partial<Range>) =>
    setRanges((r) => r.map((x, ri) => (ri === i ? { ...x, ...patch } : x)));

  const onPickTime = (t: string) => {
    if (!picking) return;
    const r = ranges[picking.range];
    if (picking.which === 'start') {
      const end = toMinutes(t) >= toMinutes(r.end) ? TIME_OPTIONS[Math.min(TIME_OPTIONS.indexOf(t) + 2, TIME_OPTIONS.length - 1)] : r.end;
      setRange(picking.range, { start: t, end });
    } else {
      setRange(picking.range, { end: t });
    }
    setPicking(null);
  };

  const onSave = async () => {
    if (!selectedDate) return;
    setSaving(true);
    const input: OverrideInput = {
      date: selectedDate,
      isAvailable: !unavailableAllDay,
      ranges: unavailableAllDay ? [] : ranges.map((r) => ({ startTime: r.start, endTime: r.end })),
    };
    try {
      await saveOverride(uid, input);
      reload();
      setSelectedDate(null);
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? "Impossible d'enregistrer cette date.");
    } finally {
      setSaving(false);
    }
  };

  const onRestore = async () => {
    if (!selectedDate) return;
    setSaving(true);
    try {
      await deleteOverride(uid, selectedDate);
      reload();
      setSelectedDate(null);
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? 'Impossible de restaurer cette date.');
    } finally {
      setSaving(false);
    }
  };

  const hasExistingOverride = !!(overrides ?? []).find((o) => o.date === selectedDate);

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2">
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">Dates spécifiques</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 32 }}>
        <AvailabilityTabs active="overrides" />

        <Text className="font-sans text-sm text-muted mb-5 leading-5">
          Choisissez une date pour la marquer indisponible ou lui donner des horaires différents
          de votre planning habituel.
        </Text>

        <MonthCalendar
          year={year}
          month={month}
          monthStatus={monthStatus}
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
          onChangeMonth={(y, m) => {
            setYear(y);
            setMonth(m);
          }}
          minDate={today}
          maxDate={maxDate}
          loading={loading}
        />

        {selectedDate ? (
          <Card className="mt-5">
            <Text className="font-sans-bold text-ink text-base mb-3">
              {new Date(selectedDate + 'T00:00:00').toLocaleDateString('fr-FR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </Text>

            <View className="flex-row items-center justify-between mb-3">
              <Text className="font-sans-medium text-ink">Indisponible toute la journée</Text>
              <Switch
                value={unavailableAllDay}
                onValueChange={setUnavailableAllDay}
                trackColor={{ false: colors.line, true: colors.danger }}
                thumbColor={colors.white}
              />
            </View>

            {!unavailableAllDay ? (
              <View>
                {ranges.map((r, ri) => (
                  <View key={ri} className="flex-row items-center mb-2">
                    <Pressable
                      onPress={() => setPicking({ range: ri, which: 'start' })}
                      className="flex-1 flex-row items-center justify-center bg-bg rounded-2xl py-3 border border-line"
                    >
                      <Clock color={colors.muted} size={15} />
                      <Text className="font-sans-bold text-ink ml-2">{r.start}</Text>
                    </Pressable>
                    <Text className="font-sans text-muted mx-3">à</Text>
                    <Pressable
                      onPress={() => setPicking({ range: ri, which: 'end' })}
                      className="flex-1 flex-row items-center justify-center bg-bg rounded-2xl py-3 border border-line"
                    >
                      <Clock color={colors.muted} size={15} />
                      <Text className="font-sans-bold text-ink ml-2">{r.end}</Text>
                    </Pressable>
                    {ranges.length > 1 ? (
                      <Pressable onPress={() => removeRange(ri)} className="ml-2 p-2" hitSlop={8}>
                        <Trash2 color={colors.danger} size={18} />
                      </Pressable>
                    ) : null}
                  </View>
                ))}
                <Pressable onPress={addRange} className="flex-row items-center mt-1 mb-1">
                  <Plus color={colors.accent} size={16} />
                  <Text className="font-sans-bold text-accent text-sm ml-1">Ajouter une plage</Text>
                </Pressable>
              </View>
            ) : null}

            <Button label="Enregistrer" onPress={onSave} loading={saving} className="mt-3" />
            {hasExistingOverride ? (
              <Button label="Restaurer l'horaire habituel" variant="outline" onPress={onRestore} loading={saving} className="mt-2" />
            ) : null}
          </Card>
        ) : null}
      </ScrollView>

      <Modal visible={!!picking} animationType="slide" transparent onRequestClose={() => setPicking(null)}>
        <Pressable className="flex-1 bg-black/40 justify-end" onPress={() => setPicking(null)}>
          <Pressable className="bg-bg rounded-t-3xl" style={{ maxHeight: '70%' }} onPress={() => {}}>
            <View className="flex-row items-center justify-between px-5 pt-4 pb-2">
              <Text className="font-serif-bold text-xl text-ink">
                {picking?.which === 'start' ? 'Heure de début' : 'Heure de fin'}
              </Text>
              <Pressable onPress={() => setPicking(null)} hitSlop={10} className="p-1">
                <X color={colors.ink} size={22} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }}>
              {TIME_OPTIONS.filter((t) => {
                if (!picking) return true;
                if (picking.which === 'end') return toMinutes(t) > toMinutes(ranges[picking.range].start);
                return true;
              }).map((t) => {
                const active = picking && t === (picking.which === 'start' ? ranges[picking.range].start : ranges[picking.range].end);
                return (
                  <Pressable
                    key={t}
                    onPress={() => onPickTime(t)}
                    className={`py-3.5 px-4 rounded-2xl mb-1.5 ${active ? 'bg-accent' : 'bg-surface border border-line'}`}
                  >
                    <Text className={`font-sans-bold text-center ${active ? 'text-white' : 'text-ink'}`}>{t}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
