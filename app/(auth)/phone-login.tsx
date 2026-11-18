import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Smartphone } from 'lucide-react-native';
import { Button, Field, ScreenTitle } from '@/components/ui';
import { CountryPicker } from '@/components/CountryPicker';
import { CityCommuneFields } from '@/components/CityCommuneFields';
import { recordPlaceIfNew } from '@/services/geo';
import { PasswordField } from '@/components/PasswordField';
import { GenderField } from '@/components/GenderField';
import { DateField } from '@/components/DateField';
import { getAfricanCountry } from '@/config/africanCountries';
import { colors } from '@/theme/colors';
import { toE164 } from '@/utils/phone';
import { birthDateIssue, birthDateMessage } from '@/utils/birthDate';
import { needsPhoneIdentity, PHONE_IDENTITY_COUNTRY_CODE } from '@/services/patientIdentity';
import { countryUsesPostnom } from '@/config/countries';
import { identityNamesComplete } from '@/utils/identityNames';
import type { Gender } from '@/services/registration';
import { authErrorMessage, providerRefusal, providerRefusalMessage } from '@/utils/authError';
import { providerHomeHref } from '@/services/accessPolicy';
import {
  LoginCredentialsError,
  codeCooldownRemaining,
  loginCredentialsErrorMessage,
  markCodeSent,
} from '@/services/registration';
import { fetchOtpDeliveryInfo, otpIntroText, otpSentText, sendCodeLabel, type OtpDeliveryInfo } from '@/services/otpDelivery';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/i18n';

export default function PhoneLogin() {
  const t = useT();
  const { sendPhoneOtp, verifyPhoneOtp, saveLoginCredentials, cancelLoginCredentials, completePatientIdentity, loading } =
    useAuth();
  const { role } = useLocalSearchParams<{ role?: string }>();
  const isProvider = role === 'provider';
  const tint = isProvider ? colors.accent : colors.primary;
  const tileBg = isProvider ? 'bg-accent-50' : 'bg-primary-50';
  const variant = isProvider ? 'accent' : 'primary';

  const [step, setStep] = useState<'phone' | 'code' | 'identity' | 'credentials'>('phone');
  // Étape d'identité (patient sans nom) : compte issu du code, et suite à donner après l'enregistrement.
  const [identityUserId, setIdentityUserId] = useState<string | null>(null);
  const [afterIdentity, setAfterIdentity] = useState<'credentials' | 'home'>('home');
  const [identityFirstName, setIdentityFirstName] = useState('');
  const [identityLastName, setIdentityLastName] = useState('');
  const [identityPostNom, setIdentityPostNom] = useState('');
  const identityUsesPostnom = countryUsesPostnom(PHONE_IDENTITY_COUNTRY_CODE);
  // Le genre n'est demandé qu'ici : il est repris dans le profil, jamais redemandé.
  const [gender, setGender] = useState<Gender | null>(null);
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [city, setCity] = useState('');
  const [commune, setCommune] = useState('');
  const [countryCode, setCountryCode] = useState('CD');
  const [local, setLocal] = useState('');
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Étape e-mail + mot de passe (obligatoire après le code pour un compte créé par téléphone).
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  // Temporisation de 60 s entre deux envois du code (guide, étape 8.3), par numéro E.164 et conservée
  // hors de l'écran (module) : revenir en arrière puis rouvrir l'écran ne la contourne pas.
  const [now, setNow] = useState(() => Date.now());
  // Canal et durée du code (RPC publique) ; `null` tant que la lecture n'a pas abouti : libellé neutre.
  const [otpInfo, setOtpInfo] = useState<OtpDeliveryInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchOtpDeliveryInfo().then((info) => {
      if (!cancelled) setOtpInfo(info);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const country = getAfricanCountry(countryCode);
  const fullPhone = toE164(local, country?.dialCode) ?? '';
  const remaining = codeCooldownRemaining(fullPhone, now);

  useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [remaining > 0]);

  // Quitter l'écran en cours d'étape (retour matériel, geste) abandonne la session créée par le code.
  const cancelRef = useRef(cancelLoginCredentials);
  cancelRef.current = cancelLoginCredentials;
  useEffect(() => () => cancelRef.current(), []);

  const clearCredentials = () => {
    setEmail('');
    setPassword('');
    setConfirmPassword('');
  };

  const phoneValid = local.replace(/\D/g, '').length >= 8;

  const handleError = (e: any) => {
    const refusal = providerRefusal(e);
    if (refusal) Alert.alert(t('Connexion impossible'), providerRefusalMessage(refusal));
    else setErrorMsg(authErrorMessage(e));
  };

  const onSend = async () => {
    setErrorMsg(null);
    setSending(true);
    try {
      await sendPhoneOtp(fullPhone);
      const sentAt = Date.now();
      markCodeSent(fullPhone, sentAt);
      setNow(sentAt);
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
      const result = await verifyPhoneOtp(fullPhone, code);
      // MOB-1211-1 : un patient sans identité renseigne d'abord nom, genre, date de naissance (18 ans), ville, commune.
      if (!isProvider && result.user && needsPhoneIdentity(result.user)) {
        setCode('');
        setIdentityUserId(result.user.id);
        setAfterIdentity(result.needsLoginCredentials ? 'credentials' : 'home');
        setStep('identity');
        return;
      }
      if (result.needsLoginCredentials) {
        setCode('');
        setStep('credentials');
        return;
      }
      router.replace(result.user ? providerHomeHref(result.user) : '/(patient)');
    } catch (e: any) {
      handleError(e);
    }
  };

  const onSaveIdentity = async () => {
    setErrorMsg(null);
    if (!identityUserId) return;
    const dobIssue = birthDateIssue(dateOfBirth);
    if (dobIssue) {
      setErrorMsg(birthDateMessage(dobIssue));
      return;
    }
    setSaving(true);
    try {
      await completePatientIdentity(identityUserId, {
        firstName: identityFirstName,
        lastName: identityLastName,
        postNom: identityPostNom,
        gender,
        dateOfBirth,
        city,
        commune,
      });
      void recordPlaceIfNew(city, commune, countryCode); // saisie libre inconnue, au mieux
      if (afterIdentity === 'credentials') setStep('credentials');
      else router.replace('/(patient)');
    } catch (e: any) {
      setErrorMsg(authErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const goBackToPhone = () => {
    cancelLoginCredentials();
    clearCredentials();
    setIdentityUserId(null);
    setCode('');
    setErrorMsg(null);
    setStep('phone');
  };

  const onSaveCredentials = async () => {
    setErrorMsg(null);
    setSaving(true);
    try {
      const { user: u, outcome } = await saveLoginCredentials(email, password, confirmPassword);
      clearCredentials();
      // L'e-mail ne sert à se connecter qu'après le clic sur le lien de confirmation : on le dit avant d'entrer.
      Alert.alert(
        outcome.status === 'pending_confirmation'
          ? t("Un e-mail de confirmation t'a été envoyé à {email}. Clique sur le lien pour pouvoir te connecter aussi avec ton e-mail.", {
              email: outcome.email,
            })
          : t('Un e-mail de connexion est déjà associé à ce compte.'),
      );
      router.replace(providerHomeHref(u));
    } catch (e: any) {
      if (e instanceof LoginCredentialsError && e.kind !== 'session_expired') {
        setErrorMsg(loginCredentialsErrorMessage(e));
      } else {
        // Session expirée, rôle ou statut refusé : la session est fermée, on repart du numéro.
        clearCredentials();
        setCode('');
        setStep('phone');
        handleError(e);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable
          onPress={() =>
            step === 'credentials' || step === 'identity' ? goBackToPhone() : step === 'code' ? setStep('phone') : router.back()
          }
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
          <ScreenTitle center>
            {step === 'phone'
              ? t('Votre numéro')
              : step === 'code'
                ? t('Entrez le code')
                : step === 'identity'
                  ? t('Votre identité')
                  : t('Vos identifiants de connexion')}
          </ScreenTitle>
          <Text className="font-sans text-base text-muted mt-2 text-center">
            {step === 'phone'
              ? otpIntroText(otpInfo)
              : step === 'code'
                ? otpSentText(otpInfo)
                : step === 'identity'
                  ? t('Pour finaliser votre inscription, renseignez votre identité.')
                  : t("Ajoutez un e-mail et un mot de passe pour pouvoir aussi vous connecter par e-mail.")}
          </Text>
          {step === 'code' ? (
            <Text className="font-sans text-sm text-muted mt-1 text-center">
              {t('Code envoyé au {phone}.', { phone: fullPhone })}
            </Text>
          ) : null}
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
            <Button
              label={remaining > 0 ? t('Recevoir le code ({seconds} s)', { seconds: remaining }) : sendCodeLabel(otpInfo)}
              variant={variant}
              loading={sending}
              disabled={!phoneValid || remaining > 0}
              onPress={onSend}
            />
          </>
        ) : step === 'code' ? (
          <>
            <Field
              label={t('Code de confirmation')}
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
            <Pressable onPress={onSend} disabled={sending || remaining > 0} className="mt-4 items-center">
              <Text
                className="font-sans-semibold text-sm"
                style={{ color: tint, opacity: sending || remaining > 0 ? 0.5 : 1 }}
              >
                {sending
                  ? t('Envoi…')
                  : remaining > 0
                    ? t('Renvoyer le code ({seconds} s)', { seconds: remaining })
                    : t('Renvoyer le code')}
              </Text>
            </Pressable>
          </>
        ) : step === 'identity' ? (
          <>
            <Field label={t('Prénom')} placeholder="Marie" value={identityFirstName} onChangeText={setIdentityFirstName} />
            <Field label={t('Nom')} placeholder="Konaté" value={identityLastName} onChangeText={setIdentityLastName} />
            {identityUsesPostnom ? (
              <Field label={t('Post-nom')} placeholder="Mbala" value={identityPostNom} onChangeText={setIdentityPostNom} />
            ) : null}
            <GenderField value={gender} onChange={setGender} />
            <DateField
              label={t('Date de naissance')}
              value={dateOfBirth}
              onChange={setDateOfBirth}
              placeholder={t('Choisir une date')}
              maximumDate={new Date()}
              startOnYearSelection
            />
            <CityCommuneFields
              city={city}
              commune={commune}
              countryCode={countryCode}
              onCityChange={setCity}
              onCommuneChange={setCommune}
            />
            {errorMsg ? (
              <View className="bg-red-50 rounded-2xl px-4 py-3 mb-3">
                <Text className="font-sans-medium text-sm text-danger text-center">{errorMsg}</Text>
              </View>
            ) : null}
            <Button
              label={t('Enregistrer et continuer')}
              variant={variant}
              loading={saving}
              disabled={
                !identityNamesComplete(
                  { firstName: identityFirstName, lastName: identityLastName, postNom: identityPostNom },
                  identityUsesPostnom,
                ) ||
                !city.trim() ||
                !gender ||
                !dateOfBirth
              }
              onPress={onSaveIdentity}
            />
          </>
        ) : (
          <>
            <Field
              label={t('Adresse email')}
              placeholder="nom@exemple.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              value={email}
              onChangeText={setEmail}
            />
            <PasswordField label={t('Mot de passe')} value={password} onChangeText={setPassword} />
            <PasswordField label={t('Confirmer le mot de passe')} value={confirmPassword} onChangeText={setConfirmPassword} />
            {errorMsg ? (
              <View className="bg-red-50 rounded-2xl px-4 py-3 mb-3">
                <Text className="font-sans-medium text-sm text-danger text-center">{errorMsg}</Text>
              </View>
            ) : null}
            <Button
              label={t('Enregistrer et continuer')}
              variant={variant}
              loading={saving}
              disabled={!email.trim() || !password || !confirmPassword}
              onPress={onSaveCredentials}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
