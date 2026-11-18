import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Link, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field, ScreenTitle } from '@/components/ui';
import { CountryPicker } from '@/components/CountryPicker';
import { getAfricanCountry } from '@/config/africanCountries';
import { countryUsesPostnom } from '@/config/countries';
import { identityNamesComplete } from '@/utils/identityNames';
import { PasswordField } from '@/components/PasswordField';
import { GenderField } from '@/components/GenderField';
import { DateField } from '@/components/DateField';
import { ResendConfirmation } from '@/components/ResendConfirmation';
import { passwordIssue } from '@/services/passwordPolicy';
import { registerPatientErrorMessage, type Gender } from '@/services/registration';
import { birthDateIssue, birthDateMessage, MAX_PLACE_LENGTH } from '@/utils/birthDate';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/i18n';

export default function RegisterPatient() {
  const t = useT();
  const { registerPatient, loading } = useAuth();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    postNom: '',
    email: '',
    phone: '',
    password: '',
    city: '',
    commune: '',
  });
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState<Gender | null>(null); // aucun choix par défaut
  const [countryCode, setCountryCode] = useState('CD'); // RD Congo par défaut
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Renseigné après un 200 `requiresEmailConfirmation` : on affiche « Vérifie ta boîte e-mail ».
  const [sent, setSent] = useState<{ email: string; at: number } | null>(null);
  const country = getAfricanCountry(countryCode);
  const usesPostnom = countryUsesPostnom(countryCode);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const onSubmit = async () => {
    setErrorMsg(null);
    if (!gender) return;
    // Contrôle des 18 ans révolus avant l'appel (le serveur le refait).
    const dobIssue = birthDateIssue(dateOfBirth);
    if (dobIssue) {
      setErrorMsg(birthDateMessage(dobIssue));
      return;
    }
    try {
      const result = await registerPatient({
        firstName: form.firstName,
        lastName: form.lastName,
        postNom: usesPostnom ? form.postNom : undefined,
        email: form.email,
        phone: form.phone,
        password: form.password,
        gender,
        countryCode,
        dateOfBirth,
        city: form.city,
        commune: form.commune,
      });
      // Pas de connexion ni de redirection automatique tant que l'adresse n'est pas confirmée.
      if (result.requiresEmailConfirmation) setSent({ email: form.email.trim(), at: Date.now() });
      else router.replace('/(patient)'); // mode mock (sans Supabase) : patient connecté
    } catch (e: any) {
      setErrorMsg(registerPatientErrorMessage(e));
    }
  };

  if (sent) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          <View className="items-center mb-7 mt-2">
            <Text className="font-serif-bold text-3xl text-primary mb-4">visiodoc</Text>
            <ScreenTitle center>{t('Vérifie ta boîte e-mail')}</ScreenTitle>
            <Text className="font-sans text-base text-muted mt-3 text-center">
              {t('Nous avons envoyé un lien de confirmation à')}
            </Text>
            <Text className="font-sans-bold text-base text-ink mt-1 text-center">{sent.email}</Text>
            <Text className="font-sans text-base text-muted mt-3 text-center">
              {t("Clique sur le lien reçu par e-mail, puis reviens dans l'application pour te connecter.")}
            </Text>
          </View>

          <ResendConfirmation email={sent.email} initialSentAt={sent.at} />

          <Button
            label={t('Se connecter')}
            className="mt-3"
            onPress={() => router.replace('/(auth)/login')}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <View className="items-center mb-7 mt-2">
          <Text className="font-serif-bold text-3xl text-primary mb-4">visiodoc</Text>
          <ScreenTitle center>{t('Créons votre compte')}</ScreenTitle>
          <Text className="font-sans text-base text-muted mt-2">{t('Quelques détails pour commencer')}</Text>
        </View>

        <Field label={t('Prénom')} placeholder="Marie" value={form.firstName} onChangeText={set('firstName')} />
        <Field label={t('Nom')} placeholder="Konaté" value={form.lastName} onChangeText={set('lastName')} />
        {usesPostnom ? (
          <Field label={t('Post-nom')} placeholder="Mbala" value={form.postNom} onChangeText={set('postNom')} />
        ) : null}
        <Field
          label={t('Email')}
          placeholder="marie.konate@gmail.com"
          autoCapitalize="none"
          keyboardType="email-address"
          value={form.email}
          onChangeText={set('email')}
        />
        <Field
          label={t('Téléphone')}
          placeholder={`${country?.dialCode ?? ''} 81 234 5678`}
          keyboardType="phone-pad"
          value={form.phone}
          onChangeText={set('phone')}
        />
        <GenderField value={gender} onChange={setGender} />
        <DateField
          label={t('Date de naissance')}
          value={dateOfBirth}
          onChange={setDateOfBirth}
          placeholder={t('Choisir une date')}
          maximumDate={new Date()}
          startOnYearSelection
        />
        <PasswordField label={t('Mot de passe')} value={form.password} onChangeText={set('password')} />
        <CountryPicker label={t('Pays')} value={countryCode} onSelect={(c) => setCountryCode(c.code)} />
        <Field
          label={t('Ville')}
          placeholder="Kinshasa"
          maxLength={MAX_PLACE_LENGTH}
          value={form.city}
          onChangeText={set('city')}
        />
        <Field
          label={t('Commune (facultatif)')}
          placeholder="Gombe"
          maxLength={MAX_PLACE_LENGTH}
          value={form.commune}
          onChangeText={set('commune')}
        />

        {errorMsg ? (
          <View className="bg-red-50 rounded-2xl px-4 py-3 mb-3">
            <Text className="font-sans-medium text-sm text-danger text-center">{errorMsg}</Text>
          </View>
        ) : null}

        <Button
          label={t('Créer mon compte')}
          loading={loading}
          disabled={
            passwordIssue(form.password) !== null ||
            !identityNamesComplete({ ...form, postNom: usesPostnom ? form.postNom : '' }, usesPostnom) ||
            !form.city.trim() ||
            !gender ||
            !dateOfBirth
          }
          onPress={onSubmit}
          className="mt-2"
        />

        <View className="flex-row justify-center mt-5">
          <Text className="font-sans text-muted">{t('Déjà inscrit ?')} </Text>
          <Link href="/(auth)/login" className="font-sans-bold text-primary">
            {t('Se connecter')}
          </Link>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
