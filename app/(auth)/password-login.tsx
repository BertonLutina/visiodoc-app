import React, { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { Button, Field, ScreenTitle } from '@/components/ui';
import { colors } from '@/theme/colors';
import { authErrorMessage, isEmailNotConfirmed, isProviderPending, PROVIDER_PENDING_MESSAGE } from '@/utils/authError';
import { ResendConfirmation } from '@/components/ResendConfirmation';
import { useAuth, type OAuthProvider } from '@/contexts/AuthContext';
import { useT } from '@/i18n';

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
  const t = useT();
  const { loginPatient, signInWithProvider, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Connexion refusée parce que l'adresse n'est pas encore confirmée : propose le renvoi de l'e-mail.
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);

  const handleError = (e: any) => {
    if (isEmailNotConfirmed(e)) {
      setUnconfirmedEmail(email.trim());
      setErrorMsg(authErrorMessage(e));
    } else if (isProviderPending(e)) Alert.alert(t('Compte en attente de validation'), t(PROVIDER_PENDING_MESSAGE));
    else setErrorMsg(authErrorMessage(e));
  };

  const onSubmit = async () => {
    setErrorMsg(null);
    setUnconfirmedEmail(null);
    try {
      await loginPatient(email, password);
      router.replace('/(patient)');
    } catch (e: any) {
      handleError(e);
    }
  };

  const onSocial = async (provider: OAuthProvider) => {
    setErrorMsg(null);
    setUnconfirmedEmail(null);
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
        <Text className="font-sans-bold text-lg text-ink">{t('Email et mot de passe')}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 16 }} keyboardShouldPersistTaps="handled">
        <View className="items-center mb-7">
          <Image
            source={require('../../assets/logo-icon-green.png')}
            style={{ width: 56, height: 64, marginBottom: 8 }}
            resizeMode="contain"
          />
          <Text className="font-serif-bold text-primary" style={{ fontSize: 22, letterSpacing: -0.2 }}>
            VisioDoc
          </Text>
          <ScreenTitle center className="mt-4">{t('Content de vous revoir')}</ScreenTitle>
          <Text className="font-sans text-base text-muted mt-2 text-center">
            {t('Accédez à votre espace santé')}
          </Text>
        </View>

        <Field
          label={t('Adresse email')}
          placeholder="marie.konate@gmail.com"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          valid={email.includes('@') && email.includes('.')}
        />
        <Field
          label={t('Mot de passe')}
          placeholder="••••••••"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <Pressable className="self-end mb-6" onPress={() => router.push('/(auth)/forgot-password')}>
          <Text className="font-sans-semibold text-sm text-primary">{t('Mot de passe oublié ?')}</Text>
        </Pressable>

        {errorMsg ? (
          <View className="bg-red-50 rounded-2xl px-4 py-3 mb-3">
            <Text className="font-sans-medium text-sm text-danger text-center">{errorMsg}</Text>
          </View>
        ) : null}

        {unconfirmedEmail ? (
          <View className="mb-3">
            <ResendConfirmation email={unconfirmedEmail} variant="outline" />
          </View>
        ) : null}

        <Button
          label={t('Se connecter')}
          loading={loading && !busy}
          disabled={!(email.includes('@') && email.includes('.')) || password.length === 0}
          onPress={onSubmit}
        />
        <Button
          label={t('Créer un compte patient')}
          variant="outline"
          className="mt-3"
          onPress={() => router.push('/(auth)/register')}
        />

        <View className="flex-row items-center my-7">
          <View className="h-px bg-line flex-1" />
          <Text className="font-sans-medium text-xs text-muted mx-3">{t('ou continuer avec')}</Text>
          <View className="h-px bg-line flex-1" />
        </View>

        <SocialButton
          label={t('Continuer avec Google')}
          badge="G"
          badgeBg="#4285F4"
          disabled={busy}
          onPress={() => onSocial('google')}
        />
        <SocialButton
          label={t('Continuer avec Outlook')}
          badge="O"
          badgeBg="#0F6CBD"
          disabled={busy}
          onPress={() => onSocial('azure')}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
