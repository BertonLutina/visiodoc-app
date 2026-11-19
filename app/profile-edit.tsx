import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { Button, Field } from '@/components/ui';
import { AvatarPicker } from '@/components/AvatarPicker';
import { CountryPicker } from '@/components/CountryPicker';
import { PhoneField } from '@/components/PhoneField';
import { colors } from '@/theme/colors';
import { authErrorMessage } from '@/utils/authError';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/i18n';

export default function ProfileEdit() {
  const t = useT();
  const { user, updateProfile, loading } = useAuth();
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [countryCode, setCountryCode] = useState(user?.countryCode ?? 'CD');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const onSave = async () => {
    setErrorMsg(null);
    try {
      // Un champ vidé n'efface pas le numéro existant (suppression non proposée : un compte créé par téléphone
      // n'aurait plus de moyen de connexion).
      await updateProfile({ firstName, lastName, ...(phone ? { phone } : {}), countryCode });
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
        <Text className="font-sans-bold text-lg text-ink">{t('Modifier le profil')}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 12 }}>
        <View className="items-center mb-6">
          <AvatarPicker
            initials={`${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || 'VD'}
            size={96}
            tone={user?.role === 'provider' ? 'clay' : 'primary'}
          />
          <Text className="font-sans text-xs text-muted mt-3">{t('Touchez la photo pour la modifier')}</Text>
        </View>
        <Field label={t('Prénom')} placeholder="Marie" value={firstName} onChangeText={setFirstName} />
        <Field label={t('Nom')} placeholder="Konaté" value={lastName} onChangeText={setLastName} />
        <PhoneField label={t('Téléphone (facultatif)')} initialValue={user?.phone ?? ''} onChange={setPhone} />
        <CountryPicker label={t('Visiodoc du compte')} value={countryCode} onSelect={(c) => setCountryCode(c.code)} />

        {user?.email ? (
          <Field label={t('Email')} value={user.email} editable={false} hint={t("L'email ne peut pas être modifié ici.")} />
        ) : null}

        {errorMsg ? (
          <View className="bg-red-50 rounded-2xl px-4 py-3 mb-3">
            <Text className="font-sans-medium text-sm text-danger text-center">{errorMsg}</Text>
          </View>
        ) : null}

        <Button label={t('Enregistrer')} loading={loading} onPress={onSave} className="mt-2" />
      </ScrollView>
    </SafeAreaView>
  );
}
