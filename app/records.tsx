import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Pill, Stethoscope, FlaskConical, Syringe, AlertTriangle } from 'lucide-react-native';
import { Card } from '@/components/ui';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { getMedicalRecords } from '@/services/patientApi';
import type { MedicalRecordKind } from '@/types';

const kindMeta: Record<MedicalRecordKind, { icon: typeof Pill; color: string; label: string }> = {
  ordonnance: { icon: Pill, color: colors.primary, label: 'Ordonnance' },
  diagnostic: { icon: Stethoscope, color: '#3B82F6', label: 'Diagnostic' },
  analyse: { icon: FlaskConical, color: '#8B5CF6', label: 'Analyse' },
  vaccin: { icon: Syringe, color: colors.success, label: 'Vaccin' },
  allergie: { icon: AlertTriangle, color: colors.warning, label: 'Allergie' },
};

const filters: { key: string; match?: MedicalRecordKind }[] = [
  { key: 'Tout' },
  { key: 'Ordon.', match: 'ordonnance' },
  { key: 'Diagn.', match: 'diagnostic' },
  { key: 'Vaccins', match: 'vaccin' },
];

export default function MedicalRecords() {
  const { user } = useAuth();
  const uid = user?.id ?? 'patient-1';
  const [active, setActive] = useState('Tout');
  const { data: records } = useAsync(() => getMedicalRecords(uid), [uid]);

  const list = useMemo(() => {
    const all = records ?? [];
    const f = filters.find((x) => x.key === active);
    if (!f?.match) return all;
    return all.filter((r) => r.kind === f.match);
  }, [active, records]);

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2">
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">Dossier médical</Text>
      </View>

      <View className="px-5 pb-2">
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {filters.map((f) => {
            const on = f.key === active;
            return (
              <Pressable
                key={f.key}
                onPress={() => setActive(f.key)}
                className={`px-4 py-2 rounded-full mr-2 ${on ? 'bg-primary' : 'bg-surface border border-line'}`}
              >
                <Text className={`text-sm font-sans-semibold ${on ? 'text-white' : 'text-muted'}`}>{f.key}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 12 }}>
        {list.map((r) => {
          const meta = kindMeta[r.kind];
          return (
            <Card key={r.id} className="mb-3 flex-row">
              <View
                className="w-11 h-11 rounded-2xl items-center justify-center mr-3"
                style={{ backgroundColor: meta.color + '22' }}
              >
                <meta.icon color={meta.color} size={20} />
              </View>
              <View className="flex-1">
                <Text className="text-xs font-sans-bold" style={{ color: meta.color }}>
                  {meta.label}
                </Text>
                <Text className="font-sans-bold text-ink mt-0.5">{r.title}</Text>
                <Text className="font-sans text-xs text-muted mt-0.5">
                  {r.author} · {r.date}
                </Text>
              </View>
            </Card>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
