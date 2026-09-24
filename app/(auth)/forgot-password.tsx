import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, KeyRound, MailCheck } from 'lucide-react-native';
import { Button, Field, ScreenTitle } from '@/components/ui';
import { colors } from '@/theme/colors';
import { authErrorMessage } from '@/utils/authError';
import { useAuth } from '@/contexts/AuthContext';

export default function ForgotPassword() {
  const { sendPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const emailValid = email.includes('@') && email.includes('.');

  const onSend = async () => {
    setErrorMsg(null);
    setSending(true);
    try {
      await sendPasswordReset(email);
      setSent(true);
    } catch (e: any) {
      setErrorMsg(authErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2">
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">Mot de passe oublié</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 24 }} keyboardShouldPersistTaps="handled">
        <View className="items-center mb-8">
          <View className="w-14 h-14 rounded-3xl bg-primary-50 items-center justify-center mb-4">
            {sent ? <MailCheck color={colors.primary} size={28} /> : <KeyRound color={colors.primary} size={28} />}
          </View>
          <ScreenTitle center>{sent ? 'Email envoyé' : 'Réinitialiser'}</ScreenTitle>
          <Text className="font-sans text-base text-muted mt-2 text-center">
            {sent
              ? `Si un compte existe pour ${email}, vous recevrez un lien pour choisir un nouveau mot de passe.`
              : 'Entrez votre email, on vous envoie un lien de réinitialisation.'}
          </Text>
        </View>

        {sent ? (
          <Button label="Retour à la connexion" onPress={() => router.back()} />
        ) : (
          <>
            <Field
              label="Adresse email"
              placeholder="marie.konate@gmail.com"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              valid={emailValid}
            />
            {errorMsg ? (
              <View className="bg-red-50 rounded-2xl px-4 py-3 mb-3">
                <Text className="font-sans-medium text-sm text-danger text-center">{errorMsg}</Text>
              </View>
            ) : null}
            <Button label="Envoyer le lien" loading={sending} disabled={!emailValid} onPress={onSend} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
