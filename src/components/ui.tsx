import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewProps,
} from 'react-native';
import { Check, AlertCircle, Eye, EyeOff } from 'lucide-react-native';
import { colors } from '@/theme/colors';

/* ---------- ScreenTitle (serif éditorial — signature Bloom) ---------- */
export function ScreenTitle({
  children,
  className = '',
  center = false,
}: {
  children: React.ReactNode;
  className?: string;
  center?: boolean;
}) {
  return (
    <Text
      className={`font-serif-bold text-ink ${center ? 'text-center' : ''} ${className}`}
      style={{ fontSize: 30, lineHeight: 36, letterSpacing: -0.3 }}
    >
      {children}
    </Text>
  );
}

/* ---------- Eyebrow (petit tag pill) ---------- */
export function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <View className={`self-start rounded-full bg-primary-50 px-3 py-1 ${className}`}>
      <Text className="font-sans-bold text-primary-700 text-xs tracking-wide">{children}</Text>
    </View>
  );
}

/* ---------- Card ---------- */
export function Card({ className = '', children, ...rest }: ViewProps & { className?: string }) {
  return (
    <View
      className={`bg-surface rounded-3xl border border-line p-4 ${className}`}
      style={{
        shadowColor: '#3B3327',
        shadowOpacity: 0.05,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 1,
      }}
      {...rest}
    >
      {children}
    </View>
  );
}

/* ---------- Button ---------- */
type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'accent' | 'soft' | 'outline' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  className?: string;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  className = '',
}: ButtonProps) {
  const base = 'rounded-2xl py-4 px-5 items-center justify-center flex-row';
  const styles = {
    primary: 'bg-primary',
    accent: 'bg-accent',
    soft: 'bg-soft',
    outline: 'border border-line bg-transparent',
    ghost: 'bg-transparent',
  }[variant];
  const textStyle = {
    primary: 'text-white',
    accent: 'text-white',
    soft: 'text-white',
    outline: 'text-ink',
    ghost: 'text-primary',
  }[variant];
  const spinner = variant === 'outline' || variant === 'ghost' ? colors.primary : colors.white;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      className={`${base} ${styles} ${disabled ? 'opacity-50' : ''} ${className}`}
      android_ripple={{ color: 'rgba(255,255,255,0.18)' }}
    >
      {loading ? (
        <ActivityIndicator color={spinner} />
      ) : (
        <Text className={`font-sans-bold text-base ${textStyle}`}>{label}</Text>
      )}
    </Pressable>
  );
}

/* ---------- Avatar (initiales) ---------- */
export function Avatar({
  initials,
  size = 48,
  tone = 'primary',
}: {
  initials: string;
  size?: number;
  tone?: 'primary' | 'light' | 'clay';
}) {
  const bg = tone === 'primary' ? colors.primary : tone === 'clay' ? colors.clay : colors.primaryLight;
  const fg = tone === 'light' ? colors.primaryDark : colors.white;
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg }}
      className="items-center justify-center"
    >
      <Text style={{ color: fg, fontSize: size * 0.36, fontFamily: 'Mulish_700Bold' }}>{initials}</Text>
    </View>
  );
}

/* ---------- Badge ---------- */
const badgeTones: Record<string, string> = {
  green: 'bg-primary-50 text-primary-700',
  amber: 'bg-sand text-clay',
  clay: 'bg-sand text-clay',
  slate: 'bg-line text-muted',
  red: 'bg-red-50 text-danger',
};

export function Badge({ label, tone = 'green' }: { label: string; tone?: keyof typeof badgeTones }) {
  const [bg, text] = badgeTones[tone].split(' ');
  return (
    <View className={`px-2.5 py-1 rounded-full ${bg}`}>
      <Text className={`text-xs font-sans-bold ${text}`}>{label}</Text>
    </View>
  );
}

/* ---------- Field (input avec label + validation) ---------- */
export function Field({
  label,
  error,
  valid,
  hint,
  secureTextEntry,
  className = '',
  ...rest
}: TextInputProps & { label?: string; error?: string; valid?: boolean; hint?: string; className?: string }) {
  const borderColor = error ? colors.danger : colors.line;
  const isPassword = !!secureTextEntry;
  const [show, setShow] = React.useState(false);
  const hasTrailing = isPassword || valid || (!!error && !isPassword);
  return (
    <View className={`mb-4 ${className}`}>
      {label ? <Text className="text-sm font-sans-semibold text-ink mb-2">{label}</Text> : null}
      <View className="flex-row items-center">
        <TextInput
          placeholderTextColor={colors.muted}
          secureTextEntry={isPassword ? !show : undefined}
          className="flex-1 rounded-2xl px-4 py-3.5 text-base text-ink bg-surface"
          style={{
            borderWidth: 1,
            borderColor,
            fontFamily: 'Mulish_400Regular',
            paddingRight: hasTrailing ? 48 : undefined,
          }}
          {...rest}
        />
        {isPassword ? (
          <Pressable
            onPress={() => setShow((s) => !s)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
            className="absolute right-3.5 p-1"
          >
            {show ? (
              <EyeOff color={colors.muted} size={20} />
            ) : (
              <Eye color={colors.muted} size={20} />
            )}
          </Pressable>
        ) : valid ? (
          <View className="absolute right-3.5">
            <View className="w-6 h-6 rounded-full bg-success items-center justify-center">
              <Check color={colors.white} size={14} strokeWidth={3} />
            </View>
          </View>
        ) : error ? (
          <View className="absolute right-3.5">
            <AlertCircle color={colors.danger} size={20} />
          </View>
        ) : null}
      </View>
      {error ? (
        <Text className="text-xs font-sans-medium text-danger mt-1.5">{error}</Text>
      ) : hint ? (
        <Text className="text-xs font-sans text-muted mt-1.5">{hint}</Text>
      ) : null}
    </View>
  );
}

/* ---------- SectionTitle (sous-titre sans gras — style Bloom) ---------- */
export function SectionTitle({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <Text className={`font-sans-bold text-ink text-lg mb-3 mt-2 ${className}`}>{children}</Text>;
}

/* ---------- Stars ---------- */
export function Stars({ rating }: { rating: number }) {
  return (
    <Text style={{ color: colors.star }} className="text-sm font-sans-semibold">
      {'★'.repeat(Math.round(rating))}
      <Text className="text-muted font-sans"> {rating.toFixed(1)}</Text>
    </Text>
  );
}
