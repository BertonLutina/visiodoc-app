import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Link, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field, ScreenTitle } from '@/components/ui';
import { CountryPicker } from '@/components/CountryPicker';
import { getAfricanCountry } from '@/config/africanCountries';
import { authErrorMessage } from '@/utils/authError';
import { useAuth } from '@/contexts/AuthContext';

export default function RegisterPatient() {
  const { registerPatient, loading } = useAuth();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
  });
  const [countryCode, setCountryCode] = useState('CD'); // RD Congo par défaut
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const country = getAfricanCountry(countryCode);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const onSubmit = async () => {
    setErrorMsg(null);
    try {
      await registerPatient({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone,
        password: form.password,
        countryCode,
      });
      router.replace('/(patient)');
    } catch (e: any) {
      setErrorMsg(authErrorMessage(e));
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <View className="items-center mb-7 mt-2">
          <Text className="font-serif-bold text-3xl text-primary mb-4">visiodoc</Text>
          <ScreenTitle center>Créons votre compte</ScreenTitle>
          <Text className="font-sans text-base text-muted mt-2">Quelques détails pour commencer</Text>
        </View>

        <Field label="Prénom" placeholder="Marie" value={form.firstName} onChangeText={set('firstName')} />
        <Field label="Nom" placeholder="Konaté" value={form.lastName} onChangeText={set('lastName')} />
        <Field
          label="Email"
          placeholder="marie.konate@gmail.com"
          autoCapitalize="none"
          keyboardType="email-address"
          value={form.email}
          onChangeText={set('email')}
        />
        <Field
          label="Téléphone"
          placeholder={`${country?.dialCode ?? ''} 81 234 5678`}
          keyboardType="phone-pad"
          value={form.phone}
          onChangeText={set('phone')}
        />
        <Field
          label="Mot de passe"
          placeholder="••••••••"
          secureTextEntry
          value={form.password}
          onChangeText={set('password')}
        />
        <CountryPicker label="Pays" value={countryCode} onSelect={(c) => setCountryCode(c.code)} />

        {errorMsg ? (
          <View className="bg-red-50 rounded-2xl px-4 py-3 mb-3">
            <Text className="font-sans-medium text-sm text-danger text-center">{errorMsg}</Text>
          </View>
        ) : null}

        <Button label="Créer mon compte" loading={loading} onPress={onSubmit} className="mt-2" />

        <View className="flex-row justify-center mt-5">
          <Text className="font-sans text-muted">Déjà inscrit ? </Text>
          <Link href="/(auth)/login" className="font-sans-bold text-primary">
            Se connecter
          </Link>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
