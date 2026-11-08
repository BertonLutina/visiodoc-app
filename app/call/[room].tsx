import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Brain, Mic, Camera, PhoneOff, MessageCircle } from 'lucide-react-native';
import { Avatar } from '@/components/ui';
import { colors } from '@/theme/colors';
import { useAsync } from '@/hooks/useAsync';
import { getCallSession } from '@/services/patientApi';
import { useT } from '@/i18n';

/**
 * Écran d'appel. La vidéo Jitsi n'est pas encore branchée :
 * le nom affiché vient de la consultation réelle (id ou salon).
 */
export default function VideoCall() {
  const t = useT();
  const { room } = useLocalSearchParams<{ room: string }>();
  const roomId = typeof room === 'string' ? room : '';
  const { data: session } = useAsync(() => getCallSession(roomId), [roomId]);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
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
              <Text className="text-white font-sans-bold">{session?.doctorName ?? t('Consultation')}</Text>
              <Text className="text-primary-100 text-xs font-sans">{t('En cours')} · {mm}:{ss}</Text>
            </View>
          </View>
        </View>

        {/* Zone vidéo (Jitsi pas encore branché) */}
        <View className="flex-1 items-center justify-center">
          <Avatar initials={session?.initials || 'VD'} size={96} />
          <Text className="text-white/70 font-sans mt-4">{t('Vidéo en attente…')}</Text>
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
