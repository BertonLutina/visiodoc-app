import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { Button, Field, ScreenTitle } from '@/components/ui';
import { colors } from '@/theme/colors';
import { BrandGlyph } from '@/components/BrandGlyph';
import { BRAND_COLORS, BRAND_WORDMARK_FONT } from '@/theme/brand';
import { authErrorMessage, isEmailNotConfirmed, providerRefusal, providerRefusalMessage } from '@/utils/authError';
import { providerHomeHref } from '@/services/accessPolicy';
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

export default function PasswordLoginProvider() {
  const t = useT();
  const { loginProvider, signInWithProvider, loading } = useAuth();
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
    } else {
      const refusal = providerRefusal(e);
      if (refusal) Alert.alert(t('Connexion impossible'), providerRefusalMessage(refusal));
      else setErrorMsg(authErrorMessage(e));
    }
  };

  const onSubmit = async () => {
    setErrorMsg(null);
    setUnconfirmedEmail(null);
    try {
      const u = await loginProvider(email, password);
      router.replace(providerHomeHref(u));
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
      if (u) router.replace(providerHomeHref(u));
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
          <View style={{ marginBottom: 8 }}>
            <BrandGlyph size={64} color={colors.accent} cameraColor={colors.bg} />
          </View>
          <Text style={{ fontFamily: BRAND_WORDMARK_FONT, fontSize: 22, color: BRAND_COLORS.wordmarkOnLight }}>VisioDoc</Text>
          <ScreenTitle center className="mt-4">{t('Connexion praticien')}</ScreenTitle>
          <Text className="font-sans text-base text-muted mt-2 text-center">{t('Portail praticien')}</Text>
        </View>

        <Field
          label={t('Email professionnel')}
          placeholder="a.diallo@clinic.cd"
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
          <Text className="font-sans-semibold text-sm text-accent">{t('Mot de passe oublié ?')}</Text>
        </Pressable>

        {errorMsg ? (
          <View className="bg-red-50 rounded-2xl px-4 py-3 mb-3">
            <Text className="font-sans-medium text-sm text-danger text-center">{errorMsg}</Text>
          </View>
        ) : null}

        {unconfirmedEmail ? (
          <View className="mb-3">
            <ResendConfirmation email={unconfirmedEmail} variant="accent" />
          </View>
        ) : null}

        <Button
          label={t('Se connecter')}
          variant="accent"
          loading={loading && !busy}
          disabled={!(email.includes('@') && email.includes('.')) || password.length === 0}
          onPress={onSubmit}
        />
        <Button
          label={t('Créer un compte praticien')}
          variant="outline"
          className="mt-3"
          onPress={() => router.push('/(auth)/register-provider')}
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

        <View className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mt-4">
          <Text className="font-sans-medium text-amber-700 text-sm text-center">
            {t("⏳ L'accès est activé après vérification de votre compte par l'administrateur.")}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
