import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChevronLeft, Clock, Plus, Trash2, X } from 'lucide-react-native';
import { Button } from '@/components/ui';
import { AvailabilityTabs } from '@/components/AvailabilityTabs';
import { MonthCalendar } from '@/components/MonthCalendar';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import {
  deleteOverride,
  getAvailability,
  getSchedulingSettings,
  saveAvailability,
  saveOverride,
  type AvailabilityInput,
} from '@/services/providerApi';
import { currentProvider } from '@/data/mockProvider';
import { DEFAULT_SETTINGS, type SchedulingSettings } from '@/services/availabilityEngine';
import {
  DAY_LABELS_LONG,
  MAX_PERIOD_DAYS,
  PAUSE_DURATIONS,
  TIME_OPTIONS,
  buildPeriodSlots,
  defaultPause,
  eachDateKey,
  hasOverlappingRanges,
  isPauseInside,
  jsDayToModel,
  overridesForRemovedSlots,
  pauseTimeOptions,
  segmentsAfterPause,
  slotKey,
  toDateKey,
  toMinutes,
  type Pause,
} from '@/utils/availability';
import { useT } from '@/i18n';

type Range = { start: string; end: string; pause: Pause | null };
type DayCfg = { enabled: boolean; ranges: Range[] };
type Period = { start: string; end: string };
type TimePick = { day: number; range: number; which: 'start' | 'end' | 'pause' };

const MONTH_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const DEFAULT_DAYS: DayCfg[] = [
  { enabled: true, ranges: [{ start: '09:00', end: '17:00', pause: null }] },
  { enabled: true, ranges: [{ start: '09:00', end: '17:00', pause: null }] },
  { enabled: true, ranges: [{ start: '09:00', end: '17:00', pause: null }] },
  { enabled: true, ranges: [{ start: '09:00', end: '17:00', pause: null }] },
  { enabled: true, ranges: [{ start: '09:00', end: '17:00', pause: null }] },
  { enabled: false, ranges: [{ start: '09:00', end: '13:00', pause: null }] },
  { enabled: false, ranges: [{ start: '09:00', end: '13:00', pause: null }] },
];

function monthPeriod(now: Date): Period {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start: toDateKey(start), end: toDateKey(end) };
}

function normalizePause(value: unknown): Pause | null {
  if (!value || typeof value !== 'object') return null;
  const pause = value as Pause;
  if (typeof pause.start !== 'string' || typeof pause.minutes !== 'number' || pause.minutes <= 0) return null;
  return { start: pause.start.slice(0, 5), minutes: pause.minutes };
}

function normalizeDays(value: unknown): DayCfg[] | null {
  if (!Array.isArray(value) || value.length !== 7) return null;
  return value.map((day) => {
    const raw = day as DayCfg;
    const ranges = Array.isArray(raw?.ranges)
      ? raw.ranges
          .filter((r) => r && typeof r.start === 'string' && typeof r.end === 'string')
          .map((r) => ({ start: r.start.slice(0, 5), end: r.end.slice(0, 5), pause: normalizePause(r.pause) }))
      : [];
    return {
      enabled: !!raw?.enabled,
      ranges: ranges.length ? ranges : [{ start: '09:00', end: '17:00', pause: null }],
    };
  });
}

function normalizePeriod(value: unknown): Period | null {
  if (!value || typeof value !== 'object') return null;
  const period = value as Period;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period.start ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(period.end ?? '')) return null;
  return period.start <= period.end ? period : { start: period.end, end: period.start };
}

function formatDateLabel(key: string, translate: (s: string) => string) {
  const [y, m, d] = key.split('-').map(Number);
  return `${d} ${translate(MONTH_SHORT[m - 1])} ${y}`;
}

function formatSlotDay(key: string, translate: (s: string) => string) {
  const [y, m, d] = key.split('-').map(Number);
  const weekday = DAY_LABELS_LONG[jsDayToModel(new Date(y, m - 1, d).getDay())];
  return `${translate(weekday)} ${d} ${translate(MONTH_SHORT[m - 1])}`;
}

export default function Availability() {
  const t = useT();
  const { user } = useAuth();
  const uid = user?.id ?? currentProvider.id;
  const storeKey = `visiodoc.availability.${uid}`;

  const [days, setDays] = useState<DayCfg[]>(DEFAULT_DAYS);
  const [period, setPeriod] = useState<Period>(() => monthPeriod(new Date()));
  const [excluded, setExcluded] = useState<string[]>([]);
  const [exclusionDates, setExclusionDates] = useState<string[]>([]);
  const [settings, setSettings] = useState<SchedulingSettings>(DEFAULT_SETTINGS);
  const [picking, setPicking] = useState<TimePick | null>(null);
  const [datePicker, setDatePicker] = useState<'start' | 'end' | null>(null);
  const [calendar, setCalendar] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const bounds = useMemo(() => {
    const min = new Date();
    min.setFullYear(min.getFullYear() - 1, 0, 1);
    const max = new Date();
    max.setFullYear(max.getFullYear() + 2, 11, 31);
    return { min, max };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      let hasLocalDays = false;
      let hasLocalPeriod = false;
      const raw = await AsyncStorage.getItem(storeKey);
      if (active && raw) {
        try {
          const saved = JSON.parse(raw);
          const localDays = normalizeDays(saved.days);
          const localPeriod = normalizePeriod(saved.period);
          if (localDays) {
            hasLocalDays = true;
            setDays(localDays);
          }
          if (localPeriod) {
            hasLocalPeriod = true;
            setPeriod(localPeriod);
          }
          if (Array.isArray(saved.excluded)) setExcluded(saved.excluded.filter((k: unknown) => typeof k === 'string'));
          if (Array.isArray(saved.exclusionDates)) {
            setExclusionDates(saved.exclusionDates.filter((k: unknown) => typeof k === 'string'));
          }
        } catch {
          /* ignore */
        }
      }
      try {
        const remote = await getAvailability(uid);
        if (!active) return;
        if (!hasLocalDays && remote.length) {
          const next = DEFAULT_DAYS.map((d) => ({ ...d, enabled: false, ranges: [] as Range[] }));
          for (const r of remote) {
            if (!next[r.dayOfWeek]) continue;
            next[r.dayOfWeek].enabled = true;
            next[r.dayOfWeek].ranges.push({
              start: r.startTime?.slice(0, 5),
              end: r.endTime?.slice(0, 5),
              pause: null,
            });
          }
          for (const d of next) if (d.ranges.length === 0) d.ranges = [{ start: '09:00', end: '17:00', pause: null }];
          setDays(next);
        }
        if (!hasLocalPeriod) {
          const from = remote.find((r) => r.validFrom)?.validFrom;
          const to = remote.find((r) => r.validTo)?.validTo;
          const remotePeriod = normalizePeriod(from && to ? { start: from, end: to } : null);
          if (remotePeriod) setPeriod(remotePeriod);
        }
      } catch {
        /* lecture serveur indisponible → on garde le local */
      }
      try {
        const remoteSettings = await getSchedulingSettings(uid);
        if (active) setSettings(remoteSettings);
      } catch {
        /* durée par défaut */
      }
    })();
    return () => {
      active = false;
    };
  }, [uid, storeKey]);

  const periodTooLong = eachDateKey(period.start, period.end).length > MAX_PERIOD_DAYS;

  const preview = useMemo(() => {
    if (periodTooLong) return [];
    return buildPeriodSlots({
      periodStart: period.start,
      periodEnd: period.end,
      days: days.map((d) => ({
        enabled: d.enabled,
        ranges: d.ranges.filter((r) => !r.pause || isPauseInside(r, r.pause)),
      })),
      durationMinutes: settings.appointmentDurationMinutes,
      intervalMinutes: settings.slotIntervalMinutes,
    });
  }, [days, period.start, period.end, periodTooLong, settings.appointmentDurationMinutes, settings.slotIntervalMinutes]);

  const excludedSet = useMemo(() => new Set(excluded), [excluded]);
  const removedCount = preview.filter((s) => excludedSet.has(slotKey(s.date, s.start))).length;
  const groups = useMemo(() => {
    const map = new Map<string, typeof preview>();
    for (const slot of preview) {
      const list = map.get(slot.date) ?? [];
      list.push(slot);
      map.set(slot.date, list);
    }
    return [...map.entries()];
  }, [preview]);

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
      d.map((x, idx) =>
        idx === day ? { ...x, ranges: [...x.ranges, { start: '14:00', end: '17:00', pause: null }] } : x,
      ),
    );

  const removeRange = (day: number, range: number) =>
    setDays((d) =>
      d.map((x, idx) => (idx === day ? { ...x, ranges: x.ranges.filter((_, ri) => ri !== range) } : x)),
    );

  const addPause = (day: number, range: number) => {
    const current = days[day].ranges[range];
    const pause = defaultPause(current);
    if (!pause) {
      Alert.alert(
        t('Heure de pause'),
        t("{day} : cette plage est trop courte pour une pause.", { day: t(DAY_LABELS_LONG[day]) }),
      );
      return;
    }
    setRange(day, range, { pause });
  };

  const onPickTime = (time: string) => {
    if (!picking) return;
    const r = days[picking.day].ranges[picking.range];
    if (picking.which === 'pause') {
      setRange(picking.day, picking.range, { pause: { start: time, minutes: r.pause?.minutes ?? 30 } });
    } else if (picking.which === 'start') {
      const end = toMinutes(time) >= toMinutes(r.end) ? TIME_OPTIONS[Math.min(TIME_OPTIONS.indexOf(time) + 2, TIME_OPTIONS.length - 1)] : r.end;
      setRange(picking.day, picking.range, { start: time, end });
    } else {
      setRange(picking.day, picking.range, { end: time });
    }
    setPicking(null);
  };

  const openDatePicker = (which: 'start' | 'end') => {
    const key = which === 'start' ? period.start : period.end;
    const [year, month] = key.split('-').map(Number);
    setCalendar({ year, month });
    setDatePicker(which);
  };

  const onPickDate = (key: string) => {
    setPeriod((current) => {
      const next = datePicker === 'start' ? { ...current, start: key } : { ...current, end: key };
      return next.start <= next.end ? next : { start: next.end, end: next.start };
    });
    setDatePicker(null);
  };

  const toggleSlot = (key: string) =>
    setExcluded((current) => (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]));

  const onSave = async () => {
    const dayWithOverlap = days.findIndex((d) => d.enabled && hasOverlappingRanges(d.ranges));
    if (dayWithOverlap !== -1) {
      Alert.alert(
        t('Plages qui se chevauchent'),
        t("{day} : corrigez les horaires avant d'enregistrer, deux plages ne peuvent pas se chevaucher.", {
          day: t(DAY_LABELS_LONG[dayWithOverlap]),
        }),
      );
      return;
    }
    const dayWithPause = days.findIndex(
      (d) => d.enabled && d.ranges.some((r) => r.pause && !isPauseInside(r, r.pause)),
    );
    if (dayWithPause !== -1) {
      Alert.alert(
        t('Heure de pause'),
        t("{day} : la pause doit rester à l'intérieur de la plage.", { day: t(DAY_LABELS_LONG[dayWithPause]) }),
      );
      return;
    }
    if (period.start > period.end) {
      Alert.alert(t('La date de fin est avant la date de début.'));
      return;
    }
    if (periodTooLong) {
      Alert.alert(t('La période ne peut pas dépasser 3 mois.'));
      return;
    }

    setStatus('saving');
    const ranges: AvailabilityInput[] = days.flatMap((d, i) =>
      d.enabled
        ? d.ranges.flatMap((r) =>
            segmentsAfterPause(r).map((segment) => ({
              dayOfWeek: i,
              startTime: segment.start,
              endTime: segment.end,
            })),
          )
        : [],
    );
    const overrides = overridesForRemovedSlots(preview, excludedSet);
    const nextExclusionDates = overrides.map((o) => o.date);
    const draft = { days, period, excluded, exclusionDates };
    await AsyncStorage.setItem(storeKey, JSON.stringify(draft));
    try {
      const { periodSynced } = await saveAvailability(uid, ranges, { validFrom: period.start, validTo: period.end });
      for (const override of overrides) await saveOverride(uid, override);
      for (const date of exclusionDates) {
        if (!nextExclusionDates.includes(date)) await deleteOverride(uid, date);
      }
      setExclusionDates(nextExclusionDates);
      await AsyncStorage.setItem(storeKey, JSON.stringify({ ...draft, exclusionDates: nextExclusionDates }));
      if (!periodSynced) {
        Alert.alert(
          t('Période'),
          t("Les horaires sont enregistrés, mais la période n'a pas pu être envoyée. Les patients peuvent voir ces horaires au-delà des dates choisies."),
        );
      }
      setStatus('saved');
    } catch (e: any) {
      Alert.alert(
        t('Échec de la synchronisation'),
        `${t("Vos disponibilités affichées aux patients n'ont peut-être pas été mises à jour.")} ${e?.message ?? t('Réessayez.')}`,
      );
      setStatus('error');
    }
    setTimeout(() => setStatus((current) => (current === 'saving' ? current : 'idle')), 3500);
  };

  const pickingRange = picking ? days[picking.day]?.ranges[picking.range] : null;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2">
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">{t('Mes disponibilités')}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 32 }}>
        <AvailabilityTabs active="weekly" />

        <Text className="font-sans text-sm text-muted mb-5 leading-5">
          {t('Définissez la période, puis les horaires de chaque jour. Indiquez l\'heure et la durée de pause dans chaque plage.')}
        </Text>

        <Text className="font-sans-bold text-ink mb-3">{t('Période')}</Text>
        <View className="bg-surface rounded-3xl border border-line p-4 mb-5">
          <View className="flex-row">
            <View className="flex-1 mr-2">
              <Text className="font-sans text-xs text-muted mb-2">{t('Du')}</Text>
              <Pressable
                onPress={() => openDatePicker('start')}
                className="bg-bg rounded-2xl py-3 px-3 border border-line"
              >
                <Text className="font-sans-bold text-ink text-center">{formatDateLabel(period.start, t)}</Text>
              </Pressable>
            </View>
            <View className="flex-1 ml-2">
              <Text className="font-sans text-xs text-muted mb-2">{t('Au')}</Text>
              <Pressable
                onPress={() => openDatePicker('end')}
                className="bg-bg rounded-2xl py-3 px-3 border border-line"
              >
                <Text className="font-sans-bold text-ink text-center">{formatDateLabel(period.end, t)}</Text>
              </Pressable>
            </View>
          </View>
          <Text className="font-sans text-xs text-muted mt-3 leading-5">
            {t('Ces horaires se répètent chaque semaine entre ces deux dates.')}
          </Text>
        </View>

        <Text className="font-sans-bold text-ink mb-3">{t('Jours de la semaine')}</Text>
        {days.map((d, i) => (
          <View key={i} className="bg-surface rounded-3xl border border-line p-4 mb-3">
            <View className="flex-row items-center justify-between">
              <Text className="font-sans-bold text-ink text-base">{t(DAY_LABELS_LONG[i])}</Text>
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
                  <View key={ri} className="mb-3">
                    <View className="flex-row items-center">
                      <Pressable
                        onPress={() => setPicking({ day: i, range: ri, which: 'start' })}
                        className="flex-1 flex-row items-center justify-center bg-bg rounded-2xl py-3 border border-line"
                      >
                        <Clock color={colors.muted} size={15} />
                        <Text className="font-sans-bold text-ink ml-2">{r.start}</Text>
                      </Pressable>
                      <Text className="font-sans text-muted mx-3">{t('à')}</Text>
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
                    {r.pause ? (
                      <View className="mt-2 bg-bg rounded-2xl p-3 border border-line">
                        <View className="flex-row items-center justify-between mb-2">
                          <Text className="font-sans-bold text-sm text-ink">{t('Heure de pause')}</Text>
                          <Pressable onPress={() => setRange(i, ri, { pause: null })} hitSlop={8}>
                            <Text className="font-sans-bold text-xs text-danger">{t('Retirer la pause')}</Text>
                          </Pressable>
                        </View>
                        <Pressable
                          onPress={() => setPicking({ day: i, range: ri, which: 'pause' })}
                          className="flex-row items-center justify-center bg-surface rounded-2xl py-3 border border-line"
                        >
                          <Clock color={colors.muted} size={15} />
                          <Text className="font-sans-bold text-ink ml-2">{r.pause.start}</Text>
                        </Pressable>
                        <Text className="font-sans text-xs text-muted mt-3 mb-2">{t('Durée de la pause')}</Text>
                        <View className="flex-row flex-wrap">
                          {PAUSE_DURATIONS.map((minutes) => {
                            const on = r.pause?.minutes === minutes;
                            return (
                              <Pressable
                                key={minutes}
                                onPress={() => setRange(i, ri, { pause: { start: r.pause!.start, minutes } })}
                                className={`px-3 py-2 rounded-xl mr-2 mb-2 ${on ? 'bg-accent' : 'bg-surface border border-line'}`}
                              >
                                <Text className={`font-sans-bold text-sm ${on ? 'text-white' : 'text-ink'}`}>
                                  {minutes} {t('min')}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        {!isPauseInside(r, r.pause) ? (
                          <Text className="font-sans text-xs text-danger mt-1">
                            {t('La pause doit rester à l\'intérieur de la plage.')}
                          </Text>
                        ) : null}
                      </View>
                    ) : (
                      <Pressable onPress={() => addPause(i, ri)} className="flex-row items-center mt-2">
                        <Plus color={colors.accent} size={16} />
                        <Text className="font-sans-bold text-accent text-sm ml-1">{t('Ajouter une pause')}</Text>
                      </Pressable>
                    )}
                  </View>
                ))}
                <Pressable onPress={() => addRange(i)} className="flex-row items-center mt-1">
                  <Plus color={colors.accent} size={16} />
                  <Text className="font-sans-bold text-accent text-sm ml-1">{t('Ajouter une plage')}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ))}

        <Text className="font-sans-bold text-ink mt-2 mb-1">{t('Créneaux proposés')}</Text>
        <Text className="font-sans text-sm text-muted mb-3 leading-5">
          {t('Touchez un créneau pour le retirer. Les patients ne pourront pas le réserver.')}
        </Text>
        {removedCount > 0 ? (
          <Text className="font-sans-bold text-sm text-accent mb-3">{t('{count} retirés', { count: removedCount })}</Text>
        ) : null}
        {periodTooLong ? (
          <View className="bg-sand rounded-2xl px-4 py-3 mb-3">
            <Text className="font-sans-medium text-sm text-clay text-center">
              {t('La période ne peut pas dépasser 3 mois.')}
            </Text>
          </View>
        ) : groups.length === 0 ? (
          <View className="bg-surface rounded-2xl border border-line px-4 py-4 mb-3">
            <Text className="font-sans text-sm text-muted text-center">{t('Aucun créneau sur cette période.')}</Text>
          </View>
        ) : (
          groups.map(([date, daySlots]) => (
            <View key={date} className="bg-surface rounded-3xl border border-line p-4 mb-3">
              <Text className="font-sans-bold text-ink mb-3">{formatSlotDay(date, t)}</Text>
              <View className="flex-row flex-wrap">
                {daySlots.map((slot) => {
                  const key = slotKey(slot.date, slot.start);
                  const off = excludedSet.has(key);
                  return (
                    <Pressable
                      key={key}
                      onPress={() => toggleSlot(key)}
                      className={`px-3 py-2 rounded-xl mr-2 mb-2 ${off ? 'bg-bg border border-line' : 'bg-accent'}`}
                    >
                      <Text
                        className={`font-sans-bold text-sm ${off ? 'text-muted' : 'text-white'}`}
                        style={off ? { textDecorationLine: 'line-through' } : undefined}
                      >
                        {slot.start}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))
        )}

        {status === 'saved' ? (
          <View className="bg-primary-50 rounded-2xl px-4 py-3 mt-2 mb-3">
            <Text className="font-sans-semibold text-sm text-primary-700 text-center">
              {t('✓ Disponibilités enregistrées')}
            </Text>
          </View>
        ) : status === 'error' ? (
          <View className="bg-sand rounded-2xl px-4 py-3 mt-2 mb-3">
            <Text className="font-sans-medium text-sm text-clay text-center">
              {t("Échec de l'enregistrement en ligne. Vos patients voient peut-être encore l'ancien planning — réessayez.")}
            </Text>
          </View>
        ) : null}

        <Button
          label={t('Enregistrer mes disponibilités')}
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
                {picking?.which === 'start'
                  ? t('Heure de début')
                  : picking?.which === 'end'
                    ? t('Heure de fin')
                    : t('Heure de pause')}
              </Text>
              <Pressable onPress={() => setPicking(null)} hitSlop={10} className="p-1">
                <X color={colors.ink} size={22} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }}>
              {(picking?.which === 'pause' && pickingRange
                ? pauseTimeOptions(pickingRange)
                : TIME_OPTIONS.filter((opt) => {
                    if (!picking || !pickingRange) return true;
                    if (picking.which === 'end') return toMinutes(opt) > toMinutes(pickingRange.start);
                    return true;
                  })
              ).map((opt) => {
                const active =
                  !!pickingRange &&
                  opt ===
                    (picking?.which === 'start'
                      ? pickingRange.start
                      : picking?.which === 'end'
                        ? pickingRange.end
                        : pickingRange.pause?.start);
                return (
                  <Pressable
                    key={opt}
                    onPress={() => onPickTime(opt)}
                    className={`py-3.5 px-4 rounded-2xl mb-1.5 ${active ? 'bg-accent' : 'bg-surface border border-line'}`}
                  >
                    <Text className={`font-sans-bold text-center ${active ? 'text-white' : 'text-ink'}`}>{opt}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!datePicker} animationType="slide" transparent onRequestClose={() => setDatePicker(null)}>
        <Pressable className="flex-1 bg-black/40 justify-end" onPress={() => setDatePicker(null)}>
          <Pressable className="bg-bg rounded-t-3xl px-5 pt-4 pb-8" onPress={() => {}}>
            <View className="flex-row items-center justify-between mb-3">
              <Text className="font-serif-bold text-xl text-ink">
                {datePicker === 'start' ? t('Date de début') : t('Date de fin')}
              </Text>
              <Pressable onPress={() => setDatePicker(null)} hitSlop={10} className="p-1">
                <X color={colors.ink} size={22} />
              </Pressable>
            </View>
            <MonthCalendar
              year={calendar.year}
              month={calendar.month}
              monthStatus={{}}
              selectedDate={datePicker === 'start' ? period.start : period.end}
              onSelectDate={onPickDate}
              onChangeMonth={(year, month) => setCalendar({ year, month })}
              minDate={bounds.min}
              maxDate={bounds.max}
              alwaysSelectable
            />
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
