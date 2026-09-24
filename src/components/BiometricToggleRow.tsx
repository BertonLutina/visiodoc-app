import React, { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { Fingerprint, ScanFace } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';

/** Section « Sécurité » : active / désactive le déverrouillage biométrique. */
export function BiometricToggleRow({ tone = 'primary' }: { tone?: 'primary' | 'accent' }) {
  const { biometricAvailable, biometricLabel, biometricEnabled, setBiometricEnabled } = useAuth();
  const [busy, setBusy] = useState(false);

  if (!biometricAvailable) return null;

  const Icon = biometricLabel === 'Face ID' ? ScanFace : Fingerprint;
  const tint = tone === 'accent' ? colors.accent : colors.primary;
  const bg = tone === 'accent' ? 'bg-accent-50' : 'bg-primary-50';

  const onChange = async (next: boolean) => {
    setBusy(true);
    try {
      await setBiometricEnabled(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Text className="font-sans-bold text-ink text-lg mb-3 mt-4 ml-1">Sécurité</Text>
      <View className="bg-surface rounded-3xl border border-line overflow-hidden">
        <View className="flex-row items-center px-4 py-4">
          <View className={`w-10 h-10 rounded-2xl ${bg} items-center justify-center mr-3`}>
            <Icon color={tint} size={18} />
          </View>
          <View className="flex-1">
            <Text className="text-ink font-sans-semibold">Déverrouillage par {biometricLabel}</Text>
            <Text className="font-sans text-xs text-muted mt-0.5">Demandé à chaque ouverture de l'app</Text>
          </View>
          <Switch
            value={biometricEnabled}
            onValueChange={onChange}
            disabled={busy}
            trackColor={{ true: tint, false: colors.line }}
          />
        </View>
      </View>
    </>
  );
}
