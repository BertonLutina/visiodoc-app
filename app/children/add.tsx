import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { AddChildForm } from '@/components/AddChildForm';
import { colors } from '@/theme/colors';
import { useT } from '@/i18n';

export default function AddChild() {
  const t = useT();
  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2">
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">{t('Ajouter un enfant')}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <AddChildForm onAdded={() => router.back()} onCancel={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}
