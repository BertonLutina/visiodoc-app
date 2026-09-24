import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Link, Redirect, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stethoscope, FolderHeart, Wallet, Brain, ArrowRight } from 'lucide-react-native';
import { Eyebrow } from '@/components/ui';
import { DoctorCard } from '@/components/DoctorCard';
import { colors } from '@/theme/colors';
import { doctors } from '@/data/mock';
import { useAuth } from '@/contexts/AuthContext';

const services = [
  { icon: Stethoscope, title: 'Consulter', subtitle: 'Médecins dispo.', tint: 'bg-sage' },
  { icon: FolderHeart, title: 'Dossiers', subtitle: 'Historique médical', tint: 'bg-peach' },
  { icon: Wallet, title: 'Wallet', subtitle: 'Recharger, payer', tint: 'bg-sand' },
  { icon: Brain, title: 'IA Médicale', subtitle: 'Analyse symptômes', tint: 'bg-lavender' },
];

export default function PublicHome() {
  const { user, initializing } = useAuth();

  // Restauration de la session persistée : on attend avant de décider où aller.
  if (initializing) {
    return (
      <SafeAreaView className="flex-1 bg-bg items-center justify-center">
        <Text className="font-serif-bold text-3xl text-primary mb-4">visiodoc</Text>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  // Déjà connecté (session restaurée) → direct vers l'espace, sans re-login.
  if (user) {
    return <Redirect href={user.role === 'provider' ? '/(provider)' : '/(patient)'} />;
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {/* Header */}
        <View className="flex-row items-center justify-between px-5 pt-3 pb-5">
          <Text className="font-serif-bold text-2xl text-primary">visiodoc</Text>
          <Link href="/(auth)/login" className="font-sans-bold text-primary">
            Connexion
          </Link>
        </View>

        {/* Hero */}
        <View className="mx-5 rounded-[28px] bg-primary p-7 mb-7 overflow-hidden">
          <View
            className="absolute -right-10 -top-10 w-44 h-44 rounded-full"
            style={{ backgroundColor: '#15846A', opacity: 0.55 }}
          />
          <View
            className="absolute -right-2 top-16 w-28 h-28 rounded-full"
            style={{ backgroundColor: '#2E9B79', opacity: 0.45 }}
          />
          <Eyebrow className="bg-white/20 mb-4">
            <Text className="font-sans-bold text-white text-xs">Télémédecine · Afrique</Text>
          </Eyebrow>
          <Text className="font-serif-bold text-white" style={{ fontSize: 32, lineHeight: 38, letterSpacing: -0.4 }}>
            Votre médecin,{'\n'}où que vous soyez
          </Text>
          <Text className="font-sans text-white/80 text-base mt-3 mb-6">
            Consultez des médecins qualifiés par vidéo, chat ou téléphone.
          </Text>
          <Pressable
            onPress={() => router.push('/(auth)/register')}
            className="bg-white rounded-2xl py-4 px-5 flex-row items-center justify-center"
          >
            <Text className="font-sans-bold text-primary text-base mr-2">Trouver un médecin</Text>
            <ArrowRight color={colors.primary} size={18} />
          </Pressable>
        </View>

        {/* Services */}
        <Text className="px-5 font-sans-bold text-ink text-lg mb-3">Services</Text>
        <View className="px-5 flex-row flex-wrap justify-between mb-7">
          {services.map((s) => (
            <View key={s.title} className="w-[48%] bg-surface rounded-3xl border border-line p-4 mb-3">
              <View className={`w-11 h-11 rounded-2xl items-center justify-center mb-3 ${s.tint}`}>
                <s.icon color={colors.ink} size={22} />
              </View>
              <Text className="font-sans-bold text-base text-ink">{s.title}</Text>
              <Text className="font-sans text-xs text-muted mt-0.5">{s.subtitle}</Text>
            </View>
          ))}
        </View>

        {/* Médecins en vedette */}
        <Text className="px-5 font-sans-bold text-ink text-lg mb-3">Médecins en vedette</Text>
        <View className="px-5">
          {doctors.slice(0, 2).map((d) => (
            <DoctorCard key={d.id} doctor={d} onPress={() => router.push('/(auth)/login')} />
          ))}
        </View>

        {/* Accès médecin */}
        <Link
          href="/(auth)/login-provider"
          className="text-center font-sans-bold text-accent mt-5"
        >
          Vous êtes médecin ? Espace prestataire →
        </Link>
      </ScrollView>
    </SafeAreaView>
  );
}
