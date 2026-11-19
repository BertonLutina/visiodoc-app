import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, MailCheck } from 'lucide-react-native';
import { Button, Field, ScreenTitle } from '@/components/ui';
import { colors } from '@/theme/colors';
import { magicLinkCooldownRemaining, magicLinkErrorMessage } from '@/services/magicLink';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/i18n';

/**
 * Lien magique patient (même flux que le web) : on demande l'e-mail, la personne ouvre le lien reçu
 * sur cet appareil (`/auth/verify?token=…`, écran `app/auth/verify.tsx`). Aucun code à saisir.
 */
export default function MagicLinkLogin() {
  const t = useT();
  const { sendMagicLink } = useAuth();

  const [step, setStep] = useState<'email' | 'sent'>('email');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Temporisation de 60 s entre deux envois (règle du serveur), par adresse et conservée hors de l'écran.
  const [now, setNow] = useState(() => Date.now());

  const emailValid = email.includes('@') && email.includes('.');
  const remaining = magicLinkCooldownRemaining(email, now);

  useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [remaining > 0]);

  const onSend = async () => {
    if (sending || remaining > 0) return;
    setErrorMsg(null);
    setSending(true);
    try {
      await sendMagicLink(email);
      setNow(Date.now());
      setStep('sent');
    } catch (e: any) {
      setErrorMsg(magicLinkErrorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const tint = colors.primary;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable
          onPress={() => (step === 'sent' ? setStep('email') : router.back())}
          className="p-1 mr-2"
        >
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">{t('Connexion sans mot de passe')}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 24 }} keyboardShouldPersistTaps="handled">
        <View className="items-center mb-8">
          <View className="w-14 h-14 rounded-3xl items-center justify-center mb-4 bg-primary-50">
            <MailCheck color={tint} size={28} />
          </View>
          <ScreenTitle center>
            {step === 'email' ? t('Recevez un lien magique') : t('Vérifiez vos e-mails')}
          </ScreenTitle>
          <Text className="font-sans text-base text-muted mt-2 text-center">
            {step === 'email'
              ? t('On vous envoie un lien de connexion par email. Ouvrez-le sur cet appareil.')
              : t(
                  "Si un compte patient existe pour {email}, un lien de connexion vient d'être envoyé. Il est valable 15 minutes et ne s'utilise qu'une fois.",
                  { email: email.trim() },
                )}
          </Text>
        </View>

        {step === 'email' ? (
          <>
            <Field
              label={t('Adresse email')}
              placeholder="marie.konate@gmail.com"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              valid={emailValid}
            />
            <Text className="font-sans text-sm text-muted mb-3">
              {t('Réservé aux patients. Les prestataires se connectent avec leur mot de passe ou leur numéro de téléphone.')}
            </Text>
            {errorMsg ? (
              <View className="bg-red-50 rounded-2xl px-4 py-3 mb-3">
                <Text className="font-sans-medium text-sm text-danger text-center">{errorMsg}</Text>
              </View>
            ) : null}
            <Button
              label={remaining > 0 ? t('Renvoyer le lien ({seconds} s)', { seconds: remaining }) : t('Envoyer le lien')}
              loading={sending}
              disabled={!emailValid || remaining > 0}
              onPress={onSend}
            />
          </>
        ) : (
          <>
            {errorMsg ? (
              <View className="bg-red-50 rounded-2xl px-4 py-3 mb-3">
                <Text className="font-sans-medium text-sm text-danger text-center">{errorMsg}</Text>
              </View>
            ) : null}
            <Pressable onPress={onSend} disabled={sending || remaining > 0} className="mt-2 items-center">
              <Text className="font-sans-semibold text-sm" style={{ color: remaining > 0 ? colors.muted : tint }}>
                {sending
                  ? t('Envoi…')
                  : remaining > 0
                    ? t('Renvoyer le lien ({seconds} s)', { seconds: remaining })
                    : t('Renvoyer le lien')}
              </Text>
            </Pressable>
            <Pressable onPress={() => setStep('email')} className="mt-4 items-center">
              <Text className="font-sans-semibold text-sm text-muted">{t("Changer d'adresse")}</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
