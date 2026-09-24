import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stethoscope } from 'lucide-react-native';
import { Button, Field, ScreenTitle } from '@/components/ui';
import { Autocomplete } from '@/components/Autocomplete';
import { CountryPicker } from '@/components/CountryPicker';
import { SPECIALIZATIONS } from '@/config/specializations';
import { getAfricanCountry } from '@/config/africanCountries';
import { colors } from '@/theme/colors';
import { authErrorMessage } from '@/utils/authError';
import { useAuth } from '@/contexts/AuthContext';

export default function RegisterProvider() {
  const { registerProvider, loading } = useAuth();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    specialization: 'Médecine générale',
    licenseNumber: '',
    password: '',
  });
  const [countryCode, setCountryCode] = useState('CD'); // RD Congo par défaut
  const [done, setDone] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const onSubmit = async () => {
    setErrorMsg(null);
    try {
      await registerProvider({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone,
        password: form.password,
        specialization: form.specialization,
        licenseNumber: form.licenseNumber,
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
            <Stethoscope color={colors.white} size={28} />
          </View>
          <ScreenTitle center>Inscription médecin</ScreenTitle>
          <Text className="font-sans text-base text-muted mt-2">Prestataire de santé</Text>
        </View>

        {done ? (
          <View className="bg-amber-50 border border-amber-200 rounded-3xl p-6 items-center">
            <Text className="font-sans-bold text-amber-700 text-center mb-1">
              ⏳ Compte en cours de validation
            </Text>
            <Text className="font-sans text-amber-700 text-sm text-center leading-5">
              Notre équipe vérifie vos informations. Vous recevrez un email de confirmation sous 24-48h.
            </Text>
            <Link href="/(auth)/login-provider" className="font-sans-bold text-accent mt-4">
              ← Aller à la connexion
            </Link>
          </View>
        ) : (
          <>
            <Field label="Prénom" placeholder="Amara" value={form.firstName} onChangeText={set('firstName')} />
            <Field label="Nom" placeholder="Diallo" value={form.lastName} onChangeText={set('lastName')} />
            <Field
              label="Email professionnel"
              placeholder="a.diallo@clinic.sn"
              autoCapitalize="none"
              keyboardType="email-address"
              value={form.email}
              onChangeText={set('email')}
            />
            <Field
              label="Téléphone"
              placeholder={`${getAfricanCountry(countryCode)?.dialCode ?? ''} 81 234 5678`}
              keyboardType="phone-pad"
              value={form.phone}
              onChangeText={set('phone')}
            />
            <CountryPicker label="Pays" value={countryCode} onSelect={(c) => setCountryCode(c.code)} />
            <Autocomplete
              label="Spécialisation"
              value={form.specialization}
              onChangeText={set('specialization')}
              options={SPECIALIZATIONS}
              placeholder="Ex : Cardiologie"
            />
            <Field
              label="N° Licence"
              placeholder="SN-MG-2019-0042"
              value={form.licenseNumber}
              onChangeText={set('licenseNumber')}
            />
            <Field label="Mot de passe" placeholder="••••••••" secureTextEntry value={form.password} onChangeText={set('password')} />

            {errorMsg ? (
              <View className="bg-red-50 rounded-2xl px-4 py-3 mb-3">
                <Text className="font-sans-medium text-sm text-danger text-center">{errorMsg}</Text>
              </View>
            ) : null}

            <Button label="Créer mon compte" variant="accent" loading={loading} onPress={onSubmit} className="mt-2" />
            <Text className="text-center font-sans text-xs text-muted mt-3">
              ⏳ Validation par l'administrateur requise
            </Text>

            <View className="flex-row justify-center mt-5">
              <Text className="font-sans text-muted">Déjà inscrit ? </Text>
              <Link href="/(auth)/login-provider" className="font-sans-bold text-accent">
                Se connecter
              </Link>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
