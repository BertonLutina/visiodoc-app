import '../global.css';
import React, { useEffect } from 'react';
import { Platform, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFonts } from 'expo-font';
import {
  Fraunces_500Medium,
  Fraunces_600SemiBold,
  Fraunces_700Bold,
} from '@expo-google-fonts/fraunces';
import {
  Mulish_400Regular,
  Mulish_500Medium,
  Mulish_600SemiBold,
  Mulish_700Bold,
  Mulish_800ExtraBold,
} from '@expo-google-fonts/mulish';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { LanguageProvider } from '@/i18n';
import { BiometricLock } from '@/components/BiometricLock';
import { useBiometricOffer } from '@/hooks/useBiometricOffer';
import { colors } from '@/theme/colors';
import { supabaseConfigurationProblem } from '@/lib/supabase';

/** Contenu de l'app, sous AuthProvider : écran de verrou tant que la biométrie n'est pas validée. */
function AppShell() {
  const { locked } = useAuth();
  useBiometricOffer();

  if (locked) return <BiometricLock />;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(patient)" />
      <Stack.Screen name="(provider)" />
      <Stack.Screen name="doctor/[id]" options={{ presentation: 'card' }} />
      <Stack.Screen name="patient/[id]" options={{ presentation: 'card' }} />
      <Stack.Screen name="records" />
      <Stack.Screen name="provider/availability" />
      <Stack.Screen name="provider/fee" />
      <Stack.Screen name="provider/specializations" />
      <Stack.Screen name="provider/subscription" />
      <Stack.Screen name="legal/[doc]" />
      <Stack.Screen name="call/[room]" options={{ presentation: 'fullScreenModal' }} />
    </Stack>
  );
}

// Barre de navigation Android masquée par défaut sur tout l'app, révélée
// temporairement d'un swipe depuis le bord bas (mode immersif « sticky »).
function useImmersiveNavigationBar() {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    try {
      // Edge-to-edge (activé par défaut depuis SDK 54+) fait déjà en sorte que
      // masquer la barre la rend révélable d'un swipe depuis le bord, avant
      // qu'elle ne se recache — pas besoin de configurer un « behavior » à part.
      NavigationBar.setHidden(true);
    } catch {
      /* module natif pas encore lié dans ce build : dégrade en silence */
    }
  }, []);
}

export default function RootLayout() {
  useImmersiveNavigationBar();

  const [fontsLoaded] = useFonts({
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    Mulish_400Regular,
    Mulish_500Medium,
    Mulish_600SemiBold,
    Mulish_700Bold,
    Mulish_800ExtraBold,
  });

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  // Build uat / production mal configuré : écran bloquant plutôt qu'un repli silencieux sur les données mock.
  if (supabaseConfigurationProblem) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 24 }}>
        <Text accessibilityRole="alert" style={{ fontSize: 16, textAlign: 'center', color: '#B00020' }}>
          {supabaseConfigurationProblem}
        </Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <LanguageProvider>
            <StatusBar style="dark" />
            <AppShell />
          </LanguageProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
