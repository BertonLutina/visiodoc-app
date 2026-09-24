import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { Button, Field } from '@/components/ui';
import { CountryPicker } from '@/components/CountryPicker';
import { colors } from '@/theme/colors';
import { authErrorMessage } from '@/utils/authError';
import { useAuth } from '@/contexts/AuthContext';

export default function ProfileEdit() {
  const { user, updateProfile, loading } = useAuth();
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [countryCode, setCountryCode] = useState(user?.countryCode ?? 'CD');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const onSave = async () => {
    setErrorMsg(null);
    try {
      await updateProfile({ firstName, lastName, phone, countryCode });
      router.back();
    } catch (e: any) {
      setErrorMsg(authErrorMessage(e));
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2">
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">Modifier le profil</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 12 }}>
        <Field label="Prénom" placeholder="Marie" value={firstName} onChangeText={setFirstName} />
        <Field label="Nom" placeholder="Konaté" value={lastName} onChangeText={setLastName} />
        <Field
          label="Téléphone"
          placeholder="+243 81 234 5678"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
        />
        <CountryPicker label="Pays" value={countryCode} onSelect={(c) => setCountryCode(c.code)} />

        {user?.email ? (
          <Field label="Email" value={user.email} editable={false} hint="L'email ne peut pas être modifié ici." />
        ) : null}

        {errorMsg ? (
          <View className="bg-red-50 rounded-2xl px-4 py-3 mb-3">
            <Text className="font-sans-medium text-sm text-danger text-center">{errorMsg}</Text>
          </View>
        ) : null}

        <Button label="Enregistrer" loading={loading} onPress={onSave} className="mt-2" />
      </ScrollView>
    </SafeAreaView>
  );
}
