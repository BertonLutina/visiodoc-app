import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stethoscope, FolderHeart, Wallet, Brain, ArrowRight, User, X, ChevronRight } from 'lucide-react-native';
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
  const [roleModalVisible, setRoleModalVisible] = useState(false);

  const chooseRole = (href: '/(auth)/login' | '/(auth)/login-provider') => {
    setRoleModalVisible(false);
    router.push(href);
  };

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
          <Pressable onPress={() => setRoleModalVisible(true)}>
            <Text className="font-sans-bold text-primary">Connexion</Text>
          </Pressable>
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
      </ScrollView>

      <Modal
        visible={roleModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRoleModalVisible(false)}
      >
        <Pressable
          className="flex-1 items-center justify-center px-8"
          style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
          onPress={() => setRoleModalVisible(false)}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            className="w-full bg-surface rounded-[28px] p-6"
          >
            <View className="flex-row items-center justify-between mb-1">
              <Text className="font-serif-bold text-xl text-ink">Connexion</Text>
              <Pressable onPress={() => setRoleModalVisible(false)} hitSlop={10} className="p-1">
                <X color={colors.muted} size={22} />
              </Pressable>
            </View>
            <Text className="font-sans text-sm text-muted mb-5">Choisissez votre profil</Text>

            <Pressable
              onPress={() => chooseRole('/(auth)/login')}
              className="flex-row items-center bg-bg border border-line rounded-3xl p-4 mb-3"
            >
              <View className="w-12 h-12 rounded-2xl items-center justify-center mr-3.5 bg-sage">
                <User color={colors.ink} size={22} />
              </View>
              <View className="flex-1">
                <Text className="font-sans-bold text-ink text-base">Patient</Text>
                <Text className="font-sans text-sm text-muted mt-0.5">Consulter un médecin</Text>
              </View>
              <ChevronRight color={colors.muted} size={20} />
            </Pressable>

            <Pressable
              onPress={() => chooseRole('/(auth)/login-provider')}
              className="flex-row items-center bg-bg border border-line rounded-3xl p-4"
            >
              <View className="w-12 h-12 rounded-2xl items-center justify-center mr-3.5 bg-accent-50">
                <Stethoscope color={colors.accent} size={22} />
              </View>
              <View className="flex-1">
                <Text className="font-sans-bold text-ink text-base">Médecin / Prestataire</Text>
                <Text className="font-sans text-sm text-muted mt-0.5">Espace professionnel</Text>
              </View>
              <ChevronRight color={colors.muted} size={20} />
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
