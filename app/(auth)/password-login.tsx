import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { Button, Field, ScreenTitle } from '@/components/ui';
import { colors } from '@/theme/colors';
import { authErrorMessage, isProviderPending, PROVIDER_PENDING_MESSAGE } from '@/utils/authError';
import { useAuth, type OAuthProvider } from '@/contexts/AuthContext';

function SocialButton({
  label,
  badge,
  badgeBg,
  onPress,
  disabled,
}: {
  label: string;
  badge: string;
  badgeBg: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`flex-row items-center justify-center bg-surface border border-line rounded-2xl py-4 mb-3 ${disabled ? 'opacity-50' : ''}`}
    >
      <View
        className="w-6 h-6 rounded-full items-center justify-center mr-3"
        style={{ backgroundColor: badgeBg }}
      >
        <Text className="font-sans-bold text-white text-xs">{badge}</Text>
      </View>
      <Text className="font-sans-bold text-ink">{label}</Text>
    </Pressable>
  );
}

export default function PasswordLogin() {
  const { loginPatient, signInWithProvider, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleError = (e: any) => {
    if (isProviderPending(e)) Alert.alert('Compte en attente de validation', PROVIDER_PENDING_MESSAGE);
    else setErrorMsg(authErrorMessage(e));
  };

  const onSubmit = async () => {
    setErrorMsg(null);
    try {
      await loginPatient(email, password);
      router.replace('/(patient)');
    } catch (e: any) {
      handleError(e);
    }
  };

  const onSocial = async (provider: OAuthProvider) => {
    setErrorMsg(null);
    setBusy(true);
    try {
      const u = await signInWithProvider(provider);
      if (u) router.replace(u.role === 'provider' ? '/(provider)' : '/(patient)');
    } catch (e: any) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2">
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">Email et mot de passe</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 16 }} keyboardShouldPersistTaps="handled">
        <View className="items-center mb-7">
          <ScreenTitle center>Content de vous revoir</ScreenTitle>
          <Text className="font-sans text-base text-muted mt-2 text-center">
            Accédez à votre espace santé
          </Text>
        </View>

        <Field
          label="Adresse email"
          placeholder="marie.konate@gmail.com"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          valid={email.includes('@') && email.includes('.')}
        />
        <Field
          label="Mot de passe"
          placeholder="••••••••"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <Pressable className="self-end mb-6" onPress={() => router.push('/(auth)/forgot-password')}>
          <Text className="font-sans-semibold text-sm text-primary">Mot de passe oublié ?</Text>
        </Pressable>

        {errorMsg ? (
          <View className="bg-red-50 rounded-2xl px-4 py-3 mb-3">
            <Text className="font-sans-medium text-sm text-danger text-center">{errorMsg}</Text>
          </View>
        ) : null}

        <Button label="Se connecter" loading={loading && !busy} onPress={onSubmit} />
        <Button
          label="Créer un compte patient"
          variant="outline"
          className="mt-3"
          onPress={() => router.push('/(auth)/register')}
        />

        <View className="flex-row items-center my-7">
          <View className="h-px bg-line flex-1" />
          <Text className="font-sans-medium text-xs text-muted mx-3">ou continuer avec</Text>
          <View className="h-px bg-line flex-1" />
        </View>

        <SocialButton
          label="Continuer avec Google"
          badge="G"
          badgeBg="#4285F4"
          disabled={busy}
          onPress={() => onSocial('google')}
        />
        <SocialButton
          label="Continuer avec Outlook"
          badge="O"
          badgeBg="#0F6CBD"
          disabled={busy}
          onPress={() => onSocial('azure')}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
