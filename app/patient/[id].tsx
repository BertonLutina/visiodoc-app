import React from 'react';
import { ScrollView, Text, View, Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Pill, Stethoscope, FlaskConical, Syringe, AlertTriangle } from 'lucide-react-native';
import { Avatar, Card, SectionTitle } from '@/components/ui';
import { colors } from '@/theme/colors';
import { useAsync } from '@/hooks/useAsync';
import { getPatients } from '@/services/providerApi';
import { getMedicalRecords } from '@/services/patientApi';
import { currentProvider } from '@/data/mockProvider';
import { useAuth } from '@/contexts/AuthContext';
import type { MedicalRecordKind } from '@/types';

const kindMeta: Record<MedicalRecordKind, { icon: typeof Pill; color: string; label: string }> = {
  ordonnance: { icon: Pill, color: colors.primary, label: 'Ordonnance' },
  diagnostic: { icon: Stethoscope, color: '#3B82F6', label: 'Diagnostic' },
  analyse: { icon: FlaskConical, color: '#8B5CF6', label: 'Analyse' },
  vaccin: { icon: Syringe, color: colors.success, label: 'Vaccin' },
  allergie: { icon: AlertTriangle, color: colors.warning, label: 'Allergie' },
};

export default function PatientProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const doctorId = user?.id ?? currentProvider.id;

  const { data: patients } = useAsync(() => getPatients(doctorId), [doctorId]);
  const patient = (patients ?? []).find((p) => p.id === id);

  const { data: records } = useAsync(() => getMedicalRecords(id), [id]);

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2">
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">Fiche patient</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
        <View className="items-center mb-6">
          <Avatar initials={patient?.initials ?? '?'} size={80} tone="light" />
          <Text className="font-serif-bold text-2xl text-ink mt-3">
            {patient ? `${patient.firstName} ${patient.lastName}` : 'Patient'}
          </Text>
          {patient && (
            <Text className="font-sans text-sm text-muted mt-0.5">
              {patient.age} ans · {patient.gender}
            </Text>
          )}
          {patient && <Text className="font-sans text-sm text-clay mt-1">{patient.mainCondition}</Text>}
        </View>

        <SectionTitle>Dossier médical</SectionTitle>
        {(records ?? []).length === 0 ? (
          <View className="bg-surface border border-line rounded-3xl p-6 items-center">
            <Text className="font-sans-semibold text-ink text-center">Aucun élément pour le moment</Text>
          </View>
        ) : (
          (records ?? []).map((r) => {
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
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
