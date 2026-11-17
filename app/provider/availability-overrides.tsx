import React, { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CalendarOff, ChevronLeft, Clock, Info, Plane, Plus, Trash2, X } from 'lucide-react-native';
import { Button } from '@/components/ui';
import { AvailabilityTabs } from '@/components/AvailabilityTabs';
import { MonthCalendar } from '@/components/MonthCalendar';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { currentProvider } from '@/data/mockProvider';
import { useAsync } from '@/hooks/useAsync';
import {
  deleteOverrides,
  getOverrides,
  saveOverride,
  saveUnavailableDates,
  type OverrideInput,
} from '@/services/providerApi';
import { TIME_OPTIONS, hasOverlappingRanges, toDateKey, toMinutes } from '@/utils/availability';
import { MAX_EXCEPTION_DAYS, groupExceptions, periodDates, type ExceptionEntry } from '@/utils/exceptions';
import { appLocale, useT } from '@/i18n';
import type { DayStatus } from '@/services/availabilityEngine';

type Range = { start: string; end: string };
type Mode = 'day' | 'period';
type TimePick = { range: number; which: 'start' | 'end' };

const DEFAULT_RANGES: Range[] = [{ start: '09:00', end: '17:00' }];

const parseKey = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export default function AvailabilityExceptions() {
  const t = useT();
  const { user } = useAuth();
  const uid = user?.id ?? currentProvider.id;
  const today = useMemo(() => new Date(), []);
  const todayKey = toDateKey(today);

  const { data: overrides, loading, error: loadError, reload } = useAsync(() => getOverrides(uid), [uid]);

  // Formulaire
  const [formOpen, setFormOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('day');
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [activeField, setActiveField] = useState<'start' | 'end'>('start');
  const [reason, setReason] = useState('');
  const [allDay, setAllDay] = useState(true);
  const [ranges, setRanges] = useState<Range[]>(DEFAULT_RANGES);
  const [picking, setPicking] = useState<TimePick | null>(null);
  const [calendar, setCalendar] = useState({ year: today.getFullYear(), month: today.getMonth() + 1 });
  const [saving, setSaving] = useState(false);

  const entries = useMemo(
    () => groupExceptions(overrides ?? []).filter((e) => e.end >= todayKey),
    [overrides, todayKey],
  );

  const maxDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3650);
    return d;
  }, []);

  const formatDay = (key: string, withYear = true) =>
    parseKey(key).toLocaleDateString(appLocale(), {
      day: 'numeric',
      month: 'long',
      ...(withYear ? { year: 'numeric' as const } : {}),
    });

  const entryTitle = (e: ExceptionEntry) =>
    e.start === e.end ? formatDay(e.start) : `${formatDay(e.start, false)} → ${formatDay(e.end)}`;

  const resetForm = () => {
    setMode('day');
    setStartDate(null);
    setEndDate(null);
    setActiveField('start');
    setReason('');
    setAllDay(true);
    setRanges(DEFAULT_RANGES);
    setPicking(null);
    setCalendar({ year: today.getFullYear(), month: today.getMonth() + 1 });
  };

  const openNew = () => {
    resetForm();
    setFormOpen(true);
  };

  /** Une date seule (jour indisponible ou horaires modifiés) se rouvre pour modification. */
  const openEdit = (e: ExceptionEntry) => {
    if (e.dates.length !== 1) return;
    resetForm();
    setStartDate(e.start);
    setReason(e.reason ?? '');
    setAllDay(e.kind === 'unavailable');
    if (e.kind === 'custom' && e.ranges.length) {
      setRanges(e.ranges.map((r) => ({ start: r.startTime, end: r.endTime })));
    }
    const d = parseKey(e.start);
    setCalendar({ year: d.getFullYear(), month: d.getMonth() + 1 });
    setFormOpen(true);
  };

  const closeForm = () => {
    if (saving) return;
    setFormOpen(false);
    setPicking(null);
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setEndDate(null);
    setActiveField('start');
    if (next === 'period') setAllDay(true);
  };

  const onSelectDate = (key: string) => {
    if (mode === 'day') {
      setStartDate(key);
      return;
    }
    if (activeField === 'start') {
      setStartDate(key);
      if (endDate && endDate < key) setEndDate(null);
      setActiveField('end');
    } else {
      if (startDate && key < startDate) {
        setEndDate(startDate);
        setStartDate(key);
      } else {
        setEndDate(key);
      }
    }
  };

  const rangeKeys = useMemo(() => {
    if (mode !== 'period' || !startDate || !endDate) return new Set<string>();
    return new Set(periodDates(startDate, endDate));
  }, [mode, startDate, endDate]);

  const calendarStatus = useMemo(() => {
    const m: Record<string, DayStatus> = {};
    for (const o of overrides ?? []) m[o.date] = o.isAvailable ? 'available' : 'unavailable';
    return m;
  }, [overrides]);

  const selectedKey = mode === 'day' ? startDate : activeField === 'start' ? startDate : endDate;
  const periodCount = startDate && endDate ? periodDates(startDate, endDate).length : 0;
  const canSave = mode === 'day' ? !!startDate : !!startDate && !!endDate;

  const addRange = () => setRanges((r) => [...r, { start: '14:00', end: '17:00' }]);
  const removeRange = (i: number) => setRanges((r) => r.filter((_, ri) => ri !== i));
  const setRange = (i: number, patch: Partial<Range>) =>
    setRanges((r) => r.map((x, ri) => (ri === i ? { ...x, ...patch } : x)));

  const onPickTime = (time: string) => {
    if (!picking) return;
    const r = ranges[picking.range];
    if (picking.which === 'start') {
      const end =
        toMinutes(time) >= toMinutes(r.end)
          ? TIME_OPTIONS[Math.min(TIME_OPTIONS.indexOf(time) + 2, TIME_OPTIONS.length - 1)]
          : r.end;
      setRange(picking.range, { start: time, end });
    } else {
      setRange(picking.range, { end: time });
    }
    setPicking(null);
  };

  const onSave = async () => {
    if (!startDate || saving) return;
    setSaving(true);
    try {
      if (mode === 'period') {
        if (!endDate) return;
        const dates = periodDates(startDate, endDate);
        if (dates.length === 0) {
          Alert.alert(t('Période invalide'), t('La période ne peut pas dépasser un an.'));
          return;
        }
        await saveUnavailableDates(uid, dates, reason);
      } else if (allDay) {
        await saveUnavailableDates(uid, [startDate], reason);
      } else {
        if (hasOverlappingRanges(ranges)) {
          Alert.alert(
            t('Plages qui se chevauchent'),
            t('Corrigez les horaires : deux plages ne peuvent pas se chevaucher.'),
          );
          return;
        }
        const input: OverrideInput = {
          date: startDate,
          isAvailable: true,
          ranges: ranges.map((r) => ({ startTime: r.start, endTime: r.end })),
        };
        await saveOverride(uid, input);
      }
      reload();
      setFormOpen(false);
    } catch (e: any) {
      Alert.alert(t('Erreur'), e?.message ?? t("Impossible d'enregistrer cette exception."));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = (e: ExceptionEntry) => {
    Alert.alert(t('Supprimer cette exception ?'), entryTitle(e), [
      { text: t('Annuler'), style: 'cancel' },
      {
        text: t('Supprimer'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteOverrides(uid, e.dates);
            reload();
          } catch (err: any) {
            Alert.alert(t('Erreur'), err?.message ?? t('Impossible de supprimer cette exception.'));
          }
        },
      },
    ]);
  };

  const pickingRange = picking ? ranges[picking.range] : null;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2">
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">{t('Exceptions & Congés')}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 32 }}>
        <AvailabilityTabs active="overrides" />

        <Text className="font-sans text-sm text-muted mb-4 leading-5">
          {t('Marquez vos congés, vacances ou périodes d\'indisponibilité. Les exceptions ont priorité sur vos horaires hebdomadaires.')}
        </Text>

        <Button label={t('Ajouter une exception')} variant="accent" onPress={openNew} className="mb-5" />

        {loadError ? (
          <View className="bg-sand rounded-2xl px-4 py-4 items-center mb-4">
            <Text className="font-sans-medium text-sm text-clay text-center mb-3">
              {t('Impossible de charger vos exceptions.')} {loadError}
            </Text>
            <Button label={t('Réessayer')} variant="outline" onPress={reload} />
          </View>
        ) : null}

        {loading && !overrides ? (
          <Text className="font-sans text-sm text-muted text-center py-8">{t('Chargement…')}</Text>
        ) : entries.length === 0 && !loadError ? (
          <View className="bg-surface rounded-3xl border border-line px-5 py-8 items-center">
            <CalendarOff color={colors.muted} size={40} />
            <Text className="font-sans text-sm text-muted mt-3 mb-3">{t('Aucune exception configurée')}</Text>
            <Pressable onPress={openNew} hitSlop={8}>
              <Text className="font-sans-bold text-sm text-accent">{t('Ajouter une exception ou un congé')}</Text>
            </Pressable>
          </View>
        ) : (
          entries.map((e) => {
            const editable = e.dates.length === 1;
            return (
              <Pressable
                key={e.start}
                onPress={() => openEdit(e)}
                disabled={!editable}
                className="rounded-2xl border p-4 mb-3"
                style={{ backgroundColor: colors.accentLight, borderColor: '#FED7AA' }}
              >
                <View className="flex-row items-start justify-between">
                  <View className="flex-row items-center flex-1 pr-2">
                    <Plane color={colors.accent} size={18} />
                    <Text className="font-sans-bold text-ink ml-2 flex-1">{entryTitle(e)}</Text>
                  </View>
                  <Pressable onPress={() => onDelete(e)} hitSlop={10} className="p-1">
                    <Trash2 color={colors.danger} size={18} />
                  </Pressable>
                </View>
                {e.dates.length > 1 ? (
                  <Text className="font-sans text-xs text-muted mt-2">
                    {t('{count} jours', { count: e.dates.length })}
                  </Text>
                ) : null}
                {e.kind === 'custom' ? (
                  <View className="flex-row items-center mt-2">
                    <Clock color={colors.muted} size={14} />
                    <Text className="font-sans text-sm text-muted ml-2">
                      {t('Horaires modifiés')} · {e.ranges.map((r) => `${r.startTime}–${r.endTime}`).join(', ')}
                    </Text>
                  </View>
                ) : null}
                {e.reason ? (
                  <View className="bg-white rounded-xl px-3 py-2 mt-2">
                    <Text className="font-sans text-sm text-ink">{e.reason}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })
        )}

        <View className="flex-row items-start rounded-2xl p-4 mt-3" style={{ backgroundColor: colors.sage }}>
          <Info color={colors.primary} size={18} />
          <View className="flex-1 ml-3">
            <Text className="font-sans-bold text-ink text-sm mb-1">{t('Conseil')}</Text>
            <Text className="font-sans text-xs text-muted leading-5">
              {t('Les exceptions ont priorité sur les horaires hebdomadaires.')}
            </Text>
          </View>
        </View>
      </ScrollView>

      <Modal visible={formOpen} animationType="slide" transparent onRequestClose={closeForm}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
          <Pressable className="flex-1 bg-black/40 justify-end" onPress={closeForm}>
            <Pressable className="bg-bg rounded-t-3xl overflow-hidden" style={{ maxHeight: '92%' }} onPress={() => {}}>
              <View className="flex-row items-center justify-between px-5 py-4" style={{ backgroundColor: colors.accent }}>
                <Text className="font-serif-bold text-xl text-white">
                  {picking
                    ? picking.which === 'start'
                      ? t('Heure de début')
                      : t('Heure de fin')
                    : t('Ajouter une exception')}
                </Text>
                <Pressable onPress={picking ? () => setPicking(null) : closeForm} hitSlop={10} className="p-1">
                  <X color={colors.white} size={22} />
                </Pressable>
              </View>

              {picking && pickingRange ? (
                <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16 }}>
                  {TIME_OPTIONS.filter((opt) =>
                    picking.which === 'end' ? toMinutes(opt) > toMinutes(pickingRange.start) : true,
                  ).map((opt) => {
                    const active = opt === (picking.which === 'start' ? pickingRange.start : pickingRange.end);
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
              ) : (
                <>
                  <ScrollView
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 }}
                  >
                    <Text className="font-sans-medium text-sm text-ink mb-2">{t("Type d'indisponibilité")}</Text>
                    <View className="flex-row bg-surface border border-line rounded-2xl p-1 mb-5">
                      {(['day', 'period'] as const).map((m) => {
                        const on = mode === m;
                        return (
                          <Pressable
                            key={m}
                            onPress={() => switchMode(m)}
                            className={`flex-1 items-center py-2.5 rounded-xl ${on ? 'bg-accent' : ''}`}
                          >
                            <Text className={`font-sans-bold text-sm ${on ? 'text-white' : 'text-ink'}`}>
                              {m === 'day' ? t('Un jour') : t('Une période')}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    {mode === 'period' ? (
                      <View className="flex-row mb-3">
                        {(['start', 'end'] as const).map((field) => {
                          const value = field === 'start' ? startDate : endDate;
                          const on = activeField === field;
                          return (
                            <Pressable
                              key={field}
                              onPress={() => setActiveField(field)}
                              className={`flex-1 rounded-2xl py-3 px-3 border ${field === 'start' ? 'mr-2' : 'ml-2'} ${
                                on ? 'border-accent bg-peach' : 'border-line bg-surface'
                              }`}
                            >
                              <Text className="font-sans text-xs text-muted mb-1">
                                {field === 'start' ? t('Du') : t('Au')}
                              </Text>
                              <Text className="font-sans-bold text-ink text-sm">
                                {value ? formatDay(value) : t('Choisir une date')}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : (
                      <Text className="font-sans-medium text-sm text-ink mb-2">
                        {t('Date')} *{startDate ? ` · ${formatDay(startDate)}` : ''}
                      </Text>
                    )}

                    <MonthCalendar
                      year={calendar.year}
                      month={calendar.month}
                      monthStatus={calendarStatus}
                      selectedDate={selectedKey}
                      onSelectDate={onSelectDate}
                      onChangeMonth={(year, month) => setCalendar({ year, month })}
                      minDate={today}
                      maxDate={maxDate}
                      alwaysSelectable
                      configuredDates={mode === 'period' ? rangeKeys : undefined}
                    />

                    {mode === 'period' && periodCount > 0 ? (
                      <Text className="font-sans-bold text-sm text-accent mt-2">
                        {t('{count} jours', { count: periodCount })}
                      </Text>
                    ) : null}
                    {mode === 'period' && startDate && endDate && periodCount === 0 ? (
                      <Text className="font-sans text-xs text-danger mt-2">
                        {t('La période ne peut pas dépasser un an.')}
                      </Text>
                    ) : null}

                    {mode === 'day' ? (
                      <View className="mt-4">
                        <View className="flex-row items-center justify-between">
                          <Text className="font-sans-medium text-ink">{t('Indisponible toute la journée')}</Text>
                          <Switch
                            value={allDay}
                            onValueChange={setAllDay}
                            trackColor={{ false: colors.line, true: colors.danger }}
                            thumbColor={colors.white}
                          />
                        </View>
                        {!allDay ? (
                          <View className="mt-3">
                            <Text className="font-sans text-xs text-muted mb-2">
                              {t('Horaires de ce jour (à la place de votre planning habituel)')}
                            </Text>
                            {ranges.map((r, ri) => (
                              <View key={ri} className="flex-row items-center mb-2">
                                <Pressable
                                  onPress={() => setPicking({ range: ri, which: 'start' })}
                                  className="flex-1 flex-row items-center justify-center bg-surface rounded-2xl py-3 border border-line"
                                >
                                  <Clock color={colors.muted} size={15} />
                                  <Text className="font-sans-bold text-ink ml-2">{r.start}</Text>
                                </Pressable>
                                <Text className="font-sans text-muted mx-3">{t('à')}</Text>
                                <Pressable
                                  onPress={() => setPicking({ range: ri, which: 'end' })}
                                  className="flex-1 flex-row items-center justify-center bg-surface rounded-2xl py-3 border border-line"
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
                            <Pressable onPress={addRange} className="flex-row items-center mt-1">
                              <Plus color={colors.accent} size={16} />
                              <Text className="font-sans-bold text-accent text-sm ml-1">{t('Ajouter une plage')}</Text>
                            </Pressable>
                          </View>
                        ) : null}
                      </View>
                    ) : null}

                    {mode === 'period' || allDay ? (
                      <View className="mt-5">
                        <Text className="font-sans-medium text-sm text-ink mb-2">{t('Raison')}</Text>
                        <TextInput
                          value={reason}
                          onChangeText={setReason}
                          placeholder={t('Ex: Congé, Formation, Vacances...')}
                          placeholderTextColor={colors.muted}
                          multiline
                          maxLength={200}
                          className="bg-surface border border-line rounded-2xl px-4 py-3 font-sans text-ink"
                          style={{ minHeight: 80, textAlignVertical: 'top' }}
                        />
                      </View>
                    ) : null}
                  </ScrollView>

                  <View className="flex-row px-5 pt-3 pb-8 border-t border-line">
                    <View className="flex-1 mr-2">
                      <Button label={t('Annuler')} variant="outline" onPress={closeForm} disabled={saving} />
                    </View>
                    <View className="ml-2" style={{ flex: 2 }}>
                      <Button
                        label={mode === 'day' && !allDay ? t('Enregistrer') : t("Ajouter l'indisponibilité")}
                        variant="accent"
                        onPress={onSave}
                        loading={saving}
                        disabled={!canSave}
                      />
                    </View>
                  </View>
                </>
              )}
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
