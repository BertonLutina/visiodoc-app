import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Brain, Mic, Camera, PhoneOff, MessageCircle } from 'lucide-react-native';
import { Avatar } from '@/components/ui';
import { colors } from '@/theme/colors';

/**
 * Écran 8 — Appel vidéo + IA.
 * Phase 1 : UI mock du flux d'appel.
 * Phase 2 : remplacer la zone vidéo par <JitsiMeeting> de @jitsi/react-native-sdk
 *   (domaine = EXPO_PUBLIC_JITSI_DOMAIN, room = `room`), et brancher le panneau IA
 *   sur l'Edge Function `ai-symptom-analysis`.
 */
export default function VideoCall() {
  const { room } = useLocalSearchParams<{ room: string }>();
  const [seconds, setSeconds] = useState(522); // 08:42

  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <View className="flex-1 bg-ink">
      <SafeAreaView className="flex-1" edges={['top', 'bottom']}>
        {/* Header */}
        <View className="flex-row items-center justify-between px-5 pt-2">
          <View className="flex-row items-center">
            <Pressable onPress={() => router.back()} className="p-1 mr-1">
              <ChevronLeft color={colors.white} size={26} />
            </Pressable>
            <View>
              <Text className="text-white font-sans-bold">Dr. Amara Diallo</Text>
              <Text className="text-primary-100 text-xs font-sans">En cours · {mm}:{ss}</Text>
            </View>
          </View>
          <View className="flex-row items-center bg-white/15 px-3 py-1.5 rounded-full">
            <Brain color={colors.white} size={14} />
            <Text className="text-white text-xs font-sans-bold ml-1">IA Active</Text>
          </View>
        </View>

        {/* Zone vidéo (placeholder Jitsi) */}
        <View className="flex-1 items-center justify-center">
          <Avatar initials="AD" size={96} />
          <Text className="text-white/70 font-sans mt-4">Vidéo en attente…</Text>
          <Text className="text-white/30 font-sans text-xs mt-1">room: {room}</Text>
        </View>

        {/* Panneau IA */}
        <View className="mx-5 mb-4 bg-white/10 rounded-3xl p-4 border border-white/10">
          <View className="flex-row items-center mb-1">
            <Brain color={colors.primaryLight} size={16} />
            <Text className="text-white font-sans-bold ml-2">Analyse IA en cours</Text>
          </View>
          <Text className="text-white/70 font-sans text-sm leading-5">
            Symptômes : fièvre, maux de tête — analyse en cours…
          </Text>
        </View>

        {/* Barre de contrôle */}
        <View className="flex-row items-center justify-around px-8 pb-2">
          {[
            { icon: Mic, bg: 'bg-white/15' },
            { icon: Camera, bg: 'bg-white/15' },
            { icon: PhoneOff, bg: 'bg-red-500', end: true },
            { icon: MessageCircle, bg: 'bg-white/15' },
            { icon: Brain, bg: 'bg-white/15' },
          ].map((c, i) => (
            <Pressable
              key={i}
              onPress={() => c.end && router.back()}
              className={`w-14 h-14 rounded-full items-center justify-center ${c.bg}`}
            >
              <c.icon color={colors.white} size={24} />
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    </View>
  );
}
