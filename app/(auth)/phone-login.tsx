import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Smartphone } from 'lucide-react-native';
import { Button, Field, ScreenTitle } from '@/components/ui';
import { CountryPicker } from '@/components/CountryPicker';
import { getAfricanCountry } from '@/config/africanCountries';
import { colors } from '@/theme/colors';
import { toE164 } from '@/utils/phone';
import { authErrorMessage, isProviderPending, PROVIDER_PENDING_MESSAGE } from '@/utils/authError';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/i18n';

export default function PhoneLogin() {
  const t = useT();
  const { sendPhoneOtp, verifyPhoneOtp, loading } = useAuth();
  const { role } = useLocalSearchParams<{ role?: string }>();
  const isProvider = role === 'provider';
  const tint = isProvider ? colors.accent : colors.primary;
  const tileBg = isProvider ? 'bg-accent-50' : 'bg-primary-50';
  const variant = isProvider ? 'accent' : 'primary';

  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [countryCode, setCountryCode] = useState('CD');
  const [local, setLocal] = useState('');
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const country = getAfricanCountry(countryCode);
  const fullPhone = toE164(local, country?.dialCode) ?? '';
  const phoneValid = local.replace(/\D/g, '').length >= 8;

  const handleError = (e: any) => {
    if (isProviderPending(e)) Alert.alert(t('Compte en attente de validation'), t(PROVIDER_PENDING_MESSAGE));
    else setErrorMsg(authErrorMessage(e));
  };

  const onSend = async () => {
    setErrorMsg(null);
    setSending(true);
    try {
      await sendPhoneOtp(fullPhone);
      setStep('code');
    } catch (e: any) {
      handleError(e);
    } finally {
      setSending(false);
    }
  };

  const onVerify = async () => {
    setErrorMsg(null);
    try {
      const u = await verifyPhoneOtp(fullPhone, code);
      router.replace(u?.role === 'provider' ? '/(provider)' : '/(patient)');
    } catch (e: any) {
      handleError(e);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable
          onPress={() => (step === 'code' ? setStep('phone') : router.back())}
          className="p-1 mr-2"
        >
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">{t('Connexion par téléphone')}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 24 }} keyboardShouldPersistTaps="handled">
        <View className="items-center mb-8">
          <View className={`w-14 h-14 rounded-3xl items-center justify-center mb-4 ${tileBg}`}>
            <Smartphone color={tint} size={28} />
          </View>
          <ScreenTitle center>{step === 'phone' ? t('Votre numéro') : t('Entrez le code')}</ScreenTitle>
          <Text className="font-sans text-base text-muted mt-2 text-center">
            {step === 'phone'
              ? t('On vous envoie un code de vérification par SMS.')
              : t('Code envoyé au {phone}.', { phone: fullPhone })}
          </Text>
        </View>

        {step === 'phone' ? (
          <>
            <CountryPicker label={t('Pays')} value={countryCode} onSelect={(c) => setCountryCode(c.code)} />
            <Field
              label={t('Numéro de téléphone')}
              placeholder={`${country?.dialCode ?? ''} 81 234 5678`}
              keyboardType="phone-pad"
              value={local}
              onChangeText={setLocal}
              hint={local ? t('Sera envoyé au {phone}', { phone: fullPhone }) : undefined}
            />
            {errorMsg ? (
              <View className="bg-red-50 rounded-2xl px-4 py-3 mb-3">
                <Text className="font-sans-medium text-sm text-danger text-center">{errorMsg}</Text>
              </View>
            ) : null}
            <Button label={t('Recevoir le code')} variant={variant} loading={sending} disabled={!phoneValid} onPress={onSend} />
          </>
        ) : (
          <>
            <Field
              label={t('Code SMS')}
              placeholder="123456"
              keyboardType="number-pad"
              maxLength={6}
              value={code}
              onChangeText={setCode}
            />
            {errorMsg ? (
              <View className="bg-red-50 rounded-2xl px-4 py-3 mb-3">
                <Text className="font-sans-medium text-sm text-danger text-center">{errorMsg}</Text>
              </View>
            ) : null}
            <Button label={t('Se connecter')} variant={variant} loading={loading} disabled={code.length < 6} onPress={onVerify} />
            <Pressable onPress={onSend} disabled={sending} className="mt-4 items-center">
              <Text className="font-sans-semibold text-sm" style={{ color: tint }}>
                {sending ? t('Envoi…') : t('Renvoyer le code')}
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
