import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Link, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stethoscope, Mail, Smartphone, Lock, ChevronRight } from 'lucide-react-native';
import { ScreenTitle } from '@/components/ui';
import { colors } from '@/theme/colors';

type Method = {
  icon: typeof Mail;
  label: string;
  sub: string;
  href: '/(auth)/password-login' | '/(auth)/magic-link' | '/(auth)/phone-login';
  tint: string;
};

const methods: Method[] = [
  {
    icon: Lock,
    label: 'Email et mot de passe',
    sub: 'Connexion classique',
    href: '/(auth)/password-login',
    tint: 'bg-primary-50',
  },
  {
    icon: Mail,
    label: 'Lien magique par email',
    sub: 'Sans mot de passe',
    href: '/(auth)/magic-link',
    tint: 'bg-sage',
  },
  {
    icon: Smartphone,
    label: 'Numéro de téléphone',
    sub: 'Code de vérification par SMS',
    href: '/(auth)/phone-login',
    tint: 'bg-sand',
  },
];

export default function LoginPatient() {
  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 56 }}>
        <View className="items-center mb-10">
          <Stethoscope color={colors.primary} size={56} strokeWidth={1.75} />
          <Text className="font-serif-bold text-2xl text-primary mt-3 mb-5">visiodoc</Text>
          <ScreenTitle center>Content de vous revoir</ScreenTitle>
          <Text className="font-sans text-base text-muted mt-2 text-center">
            Choisissez votre méthode de connexion
          </Text>
        </View>

        {methods.map((m) => (
          <Pressable
            key={m.href}
            onPress={() => router.push(m.href)}
            className="flex-row items-center bg-surface border border-line rounded-3xl p-4 mb-3"
          >
            <View className={`w-12 h-12 rounded-2xl items-center justify-center mr-3.5 ${m.tint}`}>
              <m.icon color={colors.ink} size={22} />
            </View>
            <View className="flex-1">
              <Text className="font-sans-bold text-ink text-base">{m.label}</Text>
              <Text className="font-sans text-sm text-muted mt-0.5">{m.sub}</Text>
            </View>
            <ChevronRight color={colors.muted} size={20} />
          </Pressable>
        ))}

        <View className="flex-row justify-center mt-6">
          <Text className="font-sans text-muted">Pas encore de compte ? </Text>
          <Link href="/(auth)/register" className="font-sans-bold text-primary">
            Créer un compte
          </Link>
        </View>

        <Link href="/" className="text-center font-sans-medium text-muted mt-8">
          ← Retour à l'accueil
        </Link>
      </ScrollView>
    </SafeAreaView>
  );
}
