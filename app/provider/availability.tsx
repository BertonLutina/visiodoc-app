import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChevronLeft, Clock, X } from 'lucide-react-native';
import { Button } from '@/components/ui';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { getAvailability, saveAvailability } from '@/services/providerApi';
import { currentProvider } from '@/data/mockProvider';
import { DAY_LABELS_LONG, TIME_OPTIONS, countSlots, toMinutes } from '@/utils/availability';

type DayCfg = { enabled: boolean; start: string; end: string };

const DEFAULT_DAYS: DayCfg[] = [
  { enabled: true, start: '09:00', end: '17:00' }, // Lun
  { enabled: true, start: '09:00', end: '17:00' }, // Mar
  { enabled: true, start: '09:00', end: '17:00' }, // Mer
  { enabled: true, start: '09:00', end: '17:00' }, // Jeu
  { enabled: true, start: '09:00', end: '17:00' }, // Ven
  { enabled: false, start: '09:00', end: '13:00' }, // Sam
  { enabled: false, start: '09:00', end: '13:00' }, // Dim
];

const DURATIONS = [15, 20, 30, 45, 60];

export default function Availability() {
  const { user } = useAuth();
  const uid = user?.id ?? currentProvider.id;
  const storeKey = `visiodoc.availability.${uid}`;

  const [days, setDays] = useState<DayCfg[]>(DEFAULT_DAYS);
  const [duration, setDuration] = useState(30);
  const [picking, setPicking] = useState<{ day: number; which: 'start' | 'end' } | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'local'>('idle');

  // Charge : cache local d'abord, puis serveur si présent
  useEffect(() => {
    let active = true;
    (async () => {
      const raw = await AsyncStorage.getItem(storeKey);
      if (active && raw) {
        try {
          const v = JSON.parse(raw);
          if (v.days) setDays(v.days);
          if (v.duration) setDuration(v.duration);
        } catch {
          /* ignore */
        }
      }
      try {
        const remote = await getAvailability(uid);
        if (active && remote.length) {
          const next = DEFAULT_DAYS.map((d) => ({ ...d, enabled: false }));
          for (const r of remote) {
            if (next[r.dayOfWeek]) next[r.dayOfWeek] = { enabled: true, start: r.startTime?.slice(0, 5), end: r.endTime?.slice(0, 5) };
          }
          setDays(next);
          setDuration(remote[0].slotDuration || 30);
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

  const onPickTime = (t: string) => {
    if (!picking) return;
    const d = days[picking.day];
    if (picking.which === 'start') {
      const end = toMinutes(t) >= toMinutes(d.end) ? TIME_OPTIONS[Math.min(TIME_OPTIONS.indexOf(t) + 2, TIME_OPTIONS.length - 1)] : d.end;
      setDay(picking.day, { start: t, end });
    } else {
      setDay(picking.day, { end: t });
    }
    setPicking(null);
  };

  const onSave = async () => {
    setStatus('saving');
    const ranges = days
      .map((d, i) => (d.enabled ? { dayOfWeek: i, startTime: d.start, endTime: d.end, slotDuration: duration } : null))
      .filter((r): r is NonNullable<typeof r> => r !== null);
    await AsyncStorage.setItem(storeKey, JSON.stringify({ days, duration }));
    try {
      await saveAvailability(uid, ranges);
      setStatus('saved');
    } catch {
      // RLS / réseau → enregistré localement seulement
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
        <Text className="font-sans text-sm text-muted mb-5 leading-5">
          Définissez vos heures de consultation par jour. Les patients pourront réserver un créneau
          de vidéoconférence dans ces plages.
        </Text>

        {/* Durée d'un créneau */}
        <Text className="font-sans-bold text-ink mb-2">Durée d'un rendez-vous</Text>
        <View className="flex-row flex-wrap mb-6">
          {DURATIONS.map((d) => {
            const on = d === duration;
            return (
              <Pressable
                key={d}
                onPress={() => setDuration(d)}
                className={`px-4 py-2.5 rounded-2xl mr-2 mb-2 ${on ? 'bg-accent' : 'bg-surface border border-line'}`}
              >
                <Text className={`font-sans-bold text-sm ${on ? 'text-white' : 'text-ink'}`}>{d} min</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Jours */}
        <Text className="font-sans-bold text-ink mb-3">Jours de la semaine</Text>
        {days.map((d, i) => {
          const n = countSlots(d.start, d.end, duration);
          return (
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
                  <View className="flex-row items-center">
                    <Pressable
                      onPress={() => setPicking({ day: i, which: 'start' })}
                      className="flex-1 flex-row items-center justify-center bg-bg rounded-2xl py-3 border border-line"
                    >
                      <Clock color={colors.muted} size={15} />
                      <Text className="font-sans-bold text-ink ml-2">{d.start}</Text>
                    </Pressable>
                    <Text className="font-sans text-muted mx-3">à</Text>
                    <Pressable
                      onPress={() => setPicking({ day: i, which: 'end' })}
                      className="flex-1 flex-row items-center justify-center bg-bg rounded-2xl py-3 border border-line"
                    >
                      <Clock color={colors.muted} size={15} />
                      <Text className="font-sans-bold text-ink ml-2">{d.end}</Text>
                    </Pressable>
                  </View>
                  <Text className="font-sans text-xs text-clay mt-2">
                    {n > 0 ? `${n} créneau${n > 1 ? 'x' : ''} de ${duration} min` : 'Plage invalide'}
                  </Text>
                </View>
              ) : null}
            </View>
          );
        })}

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

      {/* Sélecteur d'heure */}
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
                if (picking.which === 'end') return toMinutes(t) > toMinutes(days[picking.day].start);
                return true;
              }).map((t) => {
                const active =
                  picking &&
                  t === (picking.which === 'start' ? days[picking.day].start : days[picking.day].end);
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
