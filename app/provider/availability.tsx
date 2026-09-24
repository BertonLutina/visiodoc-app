import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChevronLeft, Clock, Plus, Trash2, X } from 'lucide-react-native';
import { Button } from '@/components/ui';
import { AvailabilityTabs } from '@/components/AvailabilityTabs';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { getAvailability, saveAvailability, type AvailabilityInput } from '@/services/providerApi';
import { currentProvider } from '@/data/mockProvider';
import { DAY_LABELS_LONG, TIME_OPTIONS, toMinutes } from '@/utils/availability';

type Range = { start: string; end: string };
type DayCfg = { enabled: boolean; ranges: Range[] };

const DEFAULT_DAYS: DayCfg[] = [
  { enabled: true, ranges: [{ start: '09:00', end: '17:00' }] }, // Lun
  { enabled: true, ranges: [{ start: '09:00', end: '17:00' }] }, // Mar
  { enabled: true, ranges: [{ start: '09:00', end: '17:00' }] }, // Mer
  { enabled: true, ranges: [{ start: '09:00', end: '17:00' }] }, // Jeu
  { enabled: true, ranges: [{ start: '09:00', end: '17:00' }] }, // Ven
  { enabled: false, ranges: [{ start: '09:00', end: '13:00' }] }, // Sam
  { enabled: false, ranges: [{ start: '09:00', end: '13:00' }] }, // Dim
];

export default function Availability() {
  const { user } = useAuth();
  const uid = user?.id ?? currentProvider.id;
  const storeKey = `visiodoc.availability.${uid}`;

  const [days, setDays] = useState<DayCfg[]>(DEFAULT_DAYS);
  const [picking, setPicking] = useState<{ day: number; range: number; which: 'start' | 'end' } | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'local'>('idle');

  useEffect(() => {
    let active = true;
    (async () => {
      const raw = await AsyncStorage.getItem(storeKey);
      if (active && raw) {
        try {
          const v = JSON.parse(raw);
          if (v.days) setDays(v.days);
        } catch {
          /* ignore */
        }
      }
      try {
        const remote = await getAvailability(uid);
        if (active && remote.length) {
          const next = DEFAULT_DAYS.map((d) => ({ ...d, enabled: false, ranges: [] as Range[] }));
          for (const r of remote) {
            if (!next[r.dayOfWeek]) continue;
            next[r.dayOfWeek].enabled = true;
            next[r.dayOfWeek].ranges.push({ start: r.startTime?.slice(0, 5), end: r.endTime?.slice(0, 5) });
          }
          for (const d of next) if (d.ranges.length === 0) d.ranges = [{ start: '09:00', end: '17:00' }];
          setDays(next);
        }
      } catch {
        /* lecture serveur indisponible → on garde le local */
      }
    })();
    return () => {
      active = false;
    };
  }, [uid]);

  const setDay = (i: number, patch: Partial<DayCfg>) =>
    setDays((d) => d.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  const setRange = (day: number, range: number, patch: Partial<Range>) =>
    setDays((d) =>
      d.map((x, idx) =>
        idx === day ? { ...x, ranges: x.ranges.map((r, ri) => (ri === range ? { ...r, ...patch } : r)) } : x,
      ),
    );

  const addRange = (day: number) =>
    setDays((d) =>
      d.map((x, idx) => (idx === day ? { ...x, ranges: [...x.ranges, { start: '14:00', end: '17:00' }] } : x)),
    );

  const removeRange = (day: number, range: number) =>
    setDays((d) =>
      d.map((x, idx) => (idx === day ? { ...x, ranges: x.ranges.filter((_, ri) => ri !== range) } : x)),
    );

  const onPickTime = (t: string) => {
    if (!picking) return;
    const r = days[picking.day].ranges[picking.range];
    if (picking.which === 'start') {
      const end = toMinutes(t) >= toMinutes(r.end) ? TIME_OPTIONS[Math.min(TIME_OPTIONS.indexOf(t) + 2, TIME_OPTIONS.length - 1)] : r.end;
      setRange(picking.day, picking.range, { start: t, end });
    } else {
      setRange(picking.day, picking.range, { end: t });
    }
    setPicking(null);
  };

  const onSave = async () => {
    setStatus('saving');
    const ranges: AvailabilityInput[] = days.flatMap((d, i) =>
      d.enabled ? d.ranges.map((r) => ({ dayOfWeek: i, startTime: r.start, endTime: r.end })) : [],
    );
    await AsyncStorage.setItem(storeKey, JSON.stringify({ days }));
    try {
      await saveAvailability(uid, ranges);
      setStatus('saved');
    } catch {
      setStatus('local');
    }
    setTimeout(() => setStatus('idle'), 3500);
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2">
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">Mes disponibilités</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 32 }}>
        <AvailabilityTabs active="weekly" />

        <Text className="font-sans text-sm text-muted mb-5 leading-5">
          Définissez vos heures de consultation par jour. Ajoutez plusieurs plages si vous avez
          une pause (ex. le midi).
        </Text>

        <Text className="font-sans-bold text-ink mb-3">Jours de la semaine</Text>
        {days.map((d, i) => (
          <View key={i} className="bg-surface rounded-3xl border border-line p-4 mb-3">
            <View className="flex-row items-center justify-between">
              <Text className="font-sans-bold text-ink text-base">{DAY_LABELS_LONG[i]}</Text>
              <Switch
                value={d.enabled}
                onValueChange={(v) => setDay(i, { enabled: v })}
                trackColor={{ false: colors.line, true: colors.accent }}
                thumbColor={colors.white}
                ios_backgroundColor={colors.line}
              />
            </View>
            {d.enabled ? (
              <View className="mt-3">
                {d.ranges.map((r, ri) => (
                  <View key={ri} className="flex-row items-center mb-2">
                    <Pressable
                      onPress={() => setPicking({ day: i, range: ri, which: 'start' })}
                      className="flex-1 flex-row items-center justify-center bg-bg rounded-2xl py-3 border border-line"
                    >
                      <Clock color={colors.muted} size={15} />
                      <Text className="font-sans-bold text-ink ml-2">{r.start}</Text>
                    </Pressable>
                    <Text className="font-sans text-muted mx-3">à</Text>
                    <Pressable
                      onPress={() => setPicking({ day: i, range: ri, which: 'end' })}
                      className="flex-1 flex-row items-center justify-center bg-bg rounded-2xl py-3 border border-line"
                    >
                      <Clock color={colors.muted} size={15} />
                      <Text className="font-sans-bold text-ink ml-2">{r.end}</Text>
                    </Pressable>
                    {d.ranges.length > 1 ? (
                      <Pressable onPress={() => removeRange(i, ri)} className="ml-2 p-2" hitSlop={8}>
                        <Trash2 color={colors.danger} size={18} />
                      </Pressable>
                    ) : null}
                  </View>
                ))}
                <Pressable onPress={() => addRange(i)} className="flex-row items-center mt-1">
                  <Plus color={colors.accent} size={16} />
                  <Text className="font-sans-bold text-accent text-sm ml-1">Ajouter une plage</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ))}

        {status === 'saved' ? (
          <View className="bg-primary-50 rounded-2xl px-4 py-3 mt-2 mb-3">
            <Text className="font-sans-semibold text-sm text-primary-700 text-center">
              ✓ Disponibilités enregistrées
            </Text>
          </View>
        ) : status === 'local' ? (
          <View className="bg-sand rounded-2xl px-4 py-3 mt-2 mb-3">
            <Text className="font-sans-medium text-sm text-clay text-center">
              Enregistré sur cet appareil. La synchronisation serveur nécessite l'activation de la
              policy d'écriture (voir admin).
            </Text>
          </View>
        ) : null}

        <Button
          label="Enregistrer mes disponibilités"
          variant="accent"
          loading={status === 'saving'}
          onPress={onSave}
          className="mt-2"
        />
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
                if (picking.which === 'end') return toMinutes(t) > toMinutes(days[picking.day].ranges[picking.range].start);
                return true;
              }).map((t) => {
                const active =
                  picking &&
                  t ===
                    (picking.which === 'start'
                      ? days[picking.day].ranges[picking.range].start
                      : days[picking.day].ranges[picking.range].end);
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
