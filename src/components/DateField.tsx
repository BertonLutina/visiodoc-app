import React, { useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Calendar, Clock, X } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { appLocale } from '@/i18n/core';
import { useT } from '@/i18n';

type Props = {
  label?: string;
  /** 'YYYY-MM-DD' (mode date) ou 'HH:mm' (mode time) ; '' = vide. */
  value: string;
  onChange: (v: string) => void;
  mode?: 'date' | 'time';
  placeholder?: string;
  minimumDate?: Date;
  maximumDate?: Date;
  /** Android : ouvre le calendrier sur le choix de l'année (utile pour une date de naissance). */
  startOnYearSelection?: boolean;
  className?: string;
};

const pad = (n: number) => String(n).padStart(2, '0');

function parse(value: string, mode: 'date' | 'time'): Date {
  if (mode === 'time') {
    const [h, m] = value.split(':').map(Number);
    const d = new Date();
    d.setHours(Number.isFinite(h) ? h : 9, Number.isFinite(m) ? m : 0, 0, 0);
    return d;
  }
  const [y, m, d] = value.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : new Date();
}

const serialize = (d: Date, mode: 'date' | 'time') =>
  mode === 'time' ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Sélecteur de date / d'heure natif (remplace la saisie texte). Valeur stockée au format ISO. */
export function DateField({
  label,
  value,
  onChange,
  mode = 'date',
  placeholder,
  minimumDate,
  maximumDate,
  startOnYearSelection,
  className = '',
}: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(() => parse(value, mode));
  const Icon = mode === 'time' ? Clock : Calendar;

  const shown = value
    ? mode === 'time'
      ? value
      : parse(value, mode).toLocaleDateString(appLocale(), { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  const show = () => {
    setDraft(parse(value, mode));
    setOpen(true);
  };

  // API v9 : onValueChange (date choisie) et onDismiss (annulation) remplacent onChange, dépréciée.
  const onValueChange = (_e: unknown, d: Date) => {
    if (Platform.OS === 'ios') {
      setDraft(d);
      return;
    }
    setOpen(false);
    onChange(serialize(d, mode));
  };
  const onDismiss = () => {
    if (Platform.OS !== 'ios') setOpen(false);
  };

  const picker = (
    <DateTimePicker
      value={draft}
      mode={mode}
      display={Platform.OS === 'ios' ? (mode === 'date' ? 'inline' : 'spinner') : 'default'}
      themeVariant="light"
      textColor={colors.ink}
      accentColor={colors.primary}
      style={Platform.OS === 'ios' ? { alignSelf: 'center', width: '100%', minHeight: mode === 'date' ? 340 : 216 } : undefined}
      is24Hour
      locale={appLocale()}
      minimumDate={minimumDate}
      maximumDate={maximumDate}
      startOnYearSelection={Platform.OS === 'android' && mode === 'date' ? startOnYearSelection : undefined}
      onValueChange={onValueChange}
      onDismiss={onDismiss}
    />
  );

  return (
    <View className={`mb-4 ${className}`}>
      {label ? <Text className="text-sm font-sans-semibold text-ink mb-2">{label}</Text> : null}
      <Pressable
        onPress={show}
        className="flex-row items-center rounded-2xl px-4 py-3.5 bg-surface"
        style={{ borderWidth: 1, borderColor: colors.line }}
      >
        <Icon color={colors.muted} size={18} />
        <Text className={`flex-1 ml-2.5 text-base ${shown ? 'text-ink' : 'text-muted'}`} numberOfLines={1}>
          {shown || placeholder || t('Choisir une date')}
        </Text>
        {value ? (
          <Pressable onPress={() => onChange('')} hitSlop={10} accessibilityLabel={t('Effacer')}>
            <X color={colors.muted} size={16} />
          </Pressable>
        ) : null}
      </Pressable>

      {open && Platform.OS === 'android' ? picker : null}

      {Platform.OS === 'ios' ? (
        <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
          <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={() => setOpen(false)}>
            <Pressable className="bg-bg rounded-t-3xl pb-8" onPress={() => {}}>
              <View className="flex-row justify-between px-5 pt-4">
                <Pressable onPress={() => setOpen(false)} hitSlop={10}>
                  <Text className="text-muted font-sans-semibold">{t('Annuler')}</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    onChange(serialize(draft, mode));
                    setOpen(false);
                  }}
                  hitSlop={10}
                >
                  <Text className="text-primary font-sans-bold">{t('Valider')}</Text>
                </Pressable>
              </View>
              {picker}
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}
