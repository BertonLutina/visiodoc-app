import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { DAY_LABELS } from '@/utils/availability';
import type { DayStatus } from '@/services/availabilityEngine';

const MONTH_LABELS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function MonthCalendar({
  year,
  month,
  monthStatus,
  selectedDate,
  onSelectDate,
  onChangeMonth,
  minDate,
  maxDate,
  loading = false,
}: {
  year: number;
  month: number;
  monthStatus: Record<string, DayStatus>;
  selectedDate: string | null;
  onSelectDate: (key: string) => void;
  onChangeMonth: (year: number, month: number) => void;
  minDate: Date;
  maxDate: Date;
  loading?: boolean;
}) {
  const cells = useMemo(() => {
    const first = new Date(year, month - 1, 1);
    const startOffset = (first.getDay() + 6) % 7; // 0 = Lundi
    const daysInMonth = new Date(year, month, 0).getDate();
    const out: (Date | null)[] = Array(startOffset).fill(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(new Date(year, month - 1, d));
    return out;
  }, [year, month]);

  const todayKey = dateKey(new Date());
  const minDateOnly = useMemo(() => {
    const d = new Date(minDate);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [minDate]);
  const maxDateOnly = useMemo(() => {
    const d = new Date(maxDate);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [maxDate]);

  return (
    <View>
      <View className="flex-row items-center justify-between mb-3">
        <Pressable
          onPress={() => onChangeMonth(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1)}
          className="p-2"
          hitSlop={8}
        >
          <ChevronLeft color={colors.ink} size={20} />
        </Pressable>
        <Text className="font-sans-bold text-ink text-base">
          {MONTH_LABELS[month - 1]} {year}
        </Text>
        <Pressable
          onPress={() => onChangeMonth(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1)}
          className="p-2"
          hitSlop={8}
        >
          <ChevronRight color={colors.ink} size={20} />
        </Pressable>
      </View>

      <View className="flex-row mb-1">
        {DAY_LABELS.map((l) => (
          <View key={l} style={{ width: `${100 / 7}%` }} className="items-center">
            <Text className="font-sans-medium text-xs text-muted">{l}</Text>
          </View>
        ))}
      </View>

      <View className="flex-row flex-wrap">
        {cells.map((date, i) => {
          if (!date) {
            return <View key={`empty-${i}`} style={{ width: `${100 / 7}%` }} className="py-1.5" />;
          }
          const key = dateKey(date);
          const status = monthStatus[key];
          const dateOnly = new Date(date);
          dateOnly.setHours(0, 0, 0, 0);
          const outOfRange = dateOnly < minDateOnly || dateOnly > maxDateOnly;
          const disabled = outOfRange || !status || status === 'unavailable';
          const isSelected = key === selectedDate;
          const isToday = key === todayKey;

          const bg = isSelected ? colors.primary : status === 'full' ? colors.sand : 'transparent';
          const textColor = isSelected
            ? colors.white
            : disabled
              ? colors.line
              : status === 'available'
                ? colors.ink
                : colors.muted;

          return (
            <View key={key} style={{ width: `${100 / 7}%` }} className="items-center py-1.5">
              <Pressable
                onPress={() => !disabled && onSelectDate(key)}
                disabled={disabled}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: bg,
                  borderWidth: isToday && !isSelected ? 1 : 0,
                  borderColor: colors.primary,
                }}
                className="items-center justify-center"
              >
                <Text style={{ color: textColor }} className="font-sans-semibold text-sm">
                  {date.getDate()}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      {loading ? <Text className="font-sans text-xs text-muted text-center mt-2">Chargement…</Text> : null}
    </View>
  );
}
