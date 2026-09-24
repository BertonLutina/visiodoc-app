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
  href: '/(auth)/password-login-provider' | '/(auth)/magic-link' | '/(auth)/phone-login';
};

const methods: Method[] = [
  { icon: Lock, label: 'Email et mot de passe', sub: 'Connexion classique', href: '/(auth)/password-login-provider' },
  { icon: Mail, label: 'Lien magique par email', sub: 'Sans mot de passe', href: '/(auth)/magic-link' },
  { icon: Smartphone, label: 'Numéro de téléphone', sub: 'Code de vérification par SMS', href: '/(auth)/phone-login' },
];

export default function LoginProvider() {
  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 56 }}>
        <View className="items-center mb-10">
          <View className="w-14 h-14 rounded-3xl bg-accent items-center justify-center mb-4">
            <Stethoscope color={colors.white} size={28} />
          </View>
          <ScreenTitle center>Connexion médecin</ScreenTitle>
          <Text className="font-sans text-base text-muted mt-2 text-center">
            Portail prestataire — choisissez votre méthode
          </Text>
        </View>

        {methods.map((m) => (
          <Pressable
            key={m.href}
            onPress={() => router.push({ pathname: m.href, params: { role: 'provider' } })}
            className="flex-row items-center bg-surface border border-line rounded-3xl p-4 mb-3"
          >
            <View className="w-12 h-12 rounded-2xl items-center justify-center mr-3.5 bg-accent-50">
              <m.icon color={colors.accent} size={22} />
            </View>
            <View className="flex-1">
              <Text className="font-sans-bold text-ink text-base">{m.label}</Text>
              <Text className="font-sans text-sm text-muted mt-0.5">{m.sub}</Text>
            </View>
            <ChevronRight color={colors.muted} size={20} />
          </Pressable>
        ))}

        <View className="flex-row justify-center mt-6">
          <Text className="font-sans text-muted">Pas encore inscrit ? </Text>
          <Link href="/(auth)/register-provider" className="font-sans-bold text-accent">
            Créer un compte médecin
          </Link>
        </View>

        <Link href="/" className="text-center font-sans-medium text-muted mt-8">
          ← Retour à l'accueil
        </Link>
      </ScrollView>
    </SafeAreaView>
  );
}
