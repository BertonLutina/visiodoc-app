import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field, ScreenTitle } from '@/components/ui';
import { Autocomplete } from '@/components/Autocomplete';
import { CountryPicker } from '@/components/CountryPicker';
import { PhoneField } from '@/components/PhoneField';
import { CityCommuneFields } from '@/components/CityCommuneFields';
import { SPECIALIZATIONS } from '@/config/specializations';
import { getAfricanCountry } from '@/config/africanCountries';
import { PasswordField } from '@/components/PasswordField';
import { GenderField } from '@/components/GenderField';
import type { Gender } from '@/services/registration';
import { passwordIssue } from '@/services/passwordPolicy';
import { authErrorMessage } from '@/utils/authError';
import { LegalNotice } from '@/components/LegalConsent';
import { useAuth } from '@/contexts/AuthContext';
import { colors } from '@/theme/colors';
import { BrandGlyph } from '@/components/BrandGlyph';
import { useT } from '@/i18n';

export default function RegisterProvider() {
  const t = useT();
  const { registerProvider, loading } = useAuth();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    specialization: 'Médecine générale',
    licenseNumber: '',
    city: '',
    password: '',
  });
  const [gender, setGender] = useState<Gender | null>(null); // aucun choix par défaut
  const [countryCode, setCountryCode] = useState('CD'); // RD Congo par défaut
  const [done, setDone] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const onSubmit = async () => {
    setErrorMsg(null);
    if (!gender) return;
    try {
      await registerProvider({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone,
        password: form.password,
        gender,
        specialization: form.specialization,
        licenseNumber: form.licenseNumber,
        city: form.city,
        countryCode,
      });
      setDone(true);
    } catch (e: any) {
      setErrorMsg(authErrorMessage(e));
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="items-center mb-7 mt-2">
          <View className="w-14 h-14 rounded-3xl bg-accent items-center justify-center mb-4">
            <BrandGlyph size={36} color={colors.white} cameraColor={colors.accent} />
          </View>
          <ScreenTitle center>{t('Inscription prestataire')}</ScreenTitle>
          <Text className="font-sans text-base text-muted mt-2">{t('Prestataire de santé')}</Text>
        </View>

        {done ? (
          <View className="bg-amber-50 border border-amber-200 rounded-3xl p-6 items-center">
            <Text className="font-sans-bold text-amber-700 text-center mb-1">
              {t('⏳ Compte en cours de validation')}
            </Text>
            <Text className="font-sans text-amber-700 text-sm text-center leading-5">
              {t('Notre équipe vérifie vos informations. Vous recevrez un email de confirmation sous 24-48h.')}
            </Text>
            <Link href="/(auth)/login-provider" className="font-sans-bold text-accent mt-4">
              {t('← Aller à la connexion')}
            </Link>
          </View>
        ) : (
          <>
            <Field label={t('Prénom')} placeholder="Amara" value={form.firstName} onChangeText={set('firstName')} />
            <Field label={t('Nom')} placeholder="Diallo" value={form.lastName} onChangeText={set('lastName')} />
            <GenderField value={gender} onChange={setGender} />
            <Field
              label={t('Email professionnel')}
              placeholder="a.diallo@clinic.sn"
              autoCapitalize="none"
              keyboardType="email-address"
              value={form.email}
              onChangeText={set('email')}
            />
            <PhoneField label={t('Téléphone (facultatif)')} onChange={set('phone')} />
            <CountryPicker label={t('Visiodoc du compte')} value={countryCode} onSelect={(c) => setCountryCode(c.code)} />
            <CityCommuneFields
              cityOnly
              city={form.city}
              commune=""
              countryCode={countryCode}
              onCityChange={set('city')}
              onCommuneChange={() => {}}
            />
            <Autocomplete
              label={t('Spécialisation')}
              value={form.specialization}
              onChangeText={set('specialization')}
              options={SPECIALIZATIONS}
              placeholder={t('Ex : Cardiologie')}
            />
            <Field
              label={t('N° Licence')}
              placeholder="SN-MG-2019-0042"
              value={form.licenseNumber}
              onChangeText={set('licenseNumber')}
            />
            <PasswordField label={t('Mot de passe')} value={form.password} onChangeText={set('password')} />

            {errorMsg ? (
              <View className="bg-red-50 rounded-2xl px-4 py-3 mb-3">
                <Text className="font-sans-medium text-sm text-danger text-center">{errorMsg}</Text>
              </View>
            ) : null}

            <Button
              label={t('Créer mon compte')}
              variant="accent"
              loading={loading}
              disabled={passwordIssue(form.password) !== null || !gender || !form.city.trim()}
              onPress={onSubmit}
              className="mt-2"
            />
            <LegalNotice className="mt-3" />
            <Text className="text-center font-sans text-xs text-muted mt-3">
              {t("⏳ Validation par l'administrateur requise")}
            </Text>

            <View className="flex-row justify-center mt-5">
              <Text className="font-sans text-muted">{t('Déjà inscrit ?')} </Text>
              <Link href="/(auth)/login-provider" className="font-sans-bold text-accent">
                {t('Se connecter')}
              </Link>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
