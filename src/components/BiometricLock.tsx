import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Fingerprint, ScanFace } from 'lucide-react-native';
import { Button } from '@/components/ui';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { authErrorMessage } from '@/utils/authError';

/** Écran affiché au lancement tant que la biométrie n'a pas été validée. */
export function BiometricLock() {
  const { lockedFirstName, unlock, logout, biometricLabel } = useAuth();
  const [busy, setBusy] = useState(false);
  const autoTried = useRef(false);
  const Icon = biometricLabel === 'Face ID' ? ScanFace : Fingerprint;

  const tryUnlock = useCallback(async () => {
    setBusy(true);
    try {
      await unlock();
    } catch (e) {
      Alert.alert('Connexion impossible', authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [unlock]);

  // Demande automatique une seule fois à l'ouverture.
  useEffect(() => {
    if (autoTried.current) return;
    autoTried.current = true;
    tryUnlock();
  }, [tryUnlock]);

  return (
    <SafeAreaView className="flex-1 bg-bg px-6">
      <View className="flex-1 items-center justify-center">
        <Text className="font-serif-bold text-3xl text-primary mb-10">visiodoc</Text>
        <View className="w-20 h-20 rounded-3xl bg-primary-50 items-center justify-center mb-6">
          <Icon color={colors.primary} size={40} />
        </View>
        <Text className="font-serif-bold text-2xl text-ink text-center">
          {lockedFirstName ? `Bonjour ${lockedFirstName}` : 'Bon retour'}
        </Text>
        <Text className="font-sans text-muted text-center mt-2">
          Déverrouillez VisioDoc pour accéder à votre espace.
        </Text>
      </View>
      <View className="pb-6">
        <Button label={`Déverrouiller avec ${biometricLabel}`} onPress={tryUnlock} loading={busy} />
        <Pressable onPress={logout} className="py-4 items-center">
          <Text className="font-sans-bold text-muted">Se déconnecter</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
