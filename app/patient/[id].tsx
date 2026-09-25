import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Plus } from 'lucide-react-native';
import { Avatar, Badge, Card, SectionTitle } from '@/components/ui';
import { colors } from '@/theme/colors';
import { useAsync } from '@/hooks/useAsync';
import { getPatient, getPatientConsultationHistory } from '@/services/providerApi';
import { getMedicalRecords } from '@/services/patientApi';
import { currentProvider } from '@/data/mockProvider';
import { useAuth } from '@/contexts/AuthContext';
import { RECORD_KIND_META, RECORD_KINDS } from '@/services/medicalRecordTaxonomy';
import type { MedicalRecordKind } from '@/types';

export default function PatientProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const doctorId = user?.id ?? currentProvider.id;
  const [activeFilter, setActiveFilter] = useState('Tout');
  const [showArchived, setShowArchived] = useState(false);

  const { data: patient, reload: reloadPatient } = useAsync(() => getPatient(id), [id]);
  const { data: records, reload: reloadRecords } = useAsync(() => getMedicalRecords(id), [id]);
  const { data: consultations } = useAsync(() => getPatientConsultationHistory(doctorId, id), [doctorId, id]);

  useFocusEffect(
    useCallback(() => {
      reloadPatient();
      reloadRecords();
    }, [reloadPatient, reloadRecords]),
  );

  const kindFilters = useMemo(
    () => [
      { key: 'Tout', match: undefined as MedicalRecordKind | undefined },
      ...RECORD_KINDS.map((k) => ({ key: RECORD_KIND_META[k].label, match: k })),
    ],
    [],
  );

  const visibleRecords = useMemo(() => {
    const all = records ?? [];
    const byStatus = showArchived ? all : all.filter((r) => r.status !== 'inactive');
    const f = kindFilters.find((x) => x.key === activeFilter);
    if (!f?.match) return byStatus;
    return byStatus.filter((r) => r.kind === f.match);
  }, [records, activeFilter, showArchived, kindFilters]);

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center justify-between px-5 pt-2 pb-2">
        <View className="flex-row items-center">
          <Pressable onPress={() => router.back()} className="p-1 mr-2">
            <ChevronLeft color={colors.ink} size={26} />
          </Pressable>
          <Text className="font-sans-bold text-lg text-ink">Fiche patient</Text>
        </View>
        <Pressable
          onPress={() => router.push(`/patient/record-form?patientId=${id}`)}
          className="flex-row items-center bg-primary px-3.5 py-2 rounded-2xl"
        >
          <Plus color={colors.white} size={16} />
          <Text className="font-sans-bold text-white text-sm ml-1">Ajouter</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
        <View className="items-center mb-6">
          <Avatar initials={patient?.initials ?? '?'} size={80} tone="light" />
          <Text className="font-serif-bold text-2xl text-ink mt-3">
            {patient ? `${patient.firstName} ${patient.lastName}` : 'Patient'}
          </Text>
          {patient && (
            <Text className="font-sans text-sm text-muted mt-0.5">
              {patient.age !== null ? `${patient.age} ans` : 'Âge inconnu'}
              {patient.gender ? ` · ${patient.gender}` : ''}
              {patient.bloodType ? ` · ${patient.bloodType}` : ''}
            </Text>
          )}
          {patient?.allergiesSummary ? (
            <View className="mt-2 bg-red-50 px-3 py-1.5 rounded-full">
              <Text className="font-sans-bold text-xs text-danger">⚠ Allergies : {patient.allergiesSummary}</Text>
            </View>
          ) : null}
        </View>

        <SectionTitle>Historique médical</SectionTitle>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3">
          {kindFilters.map((f) => {
            const on = f.key === activeFilter;
            return (
              <Pressable
                key={f.key}
                onPress={() => setActiveFilter(f.key)}
                className={`px-4 py-2 rounded-full mr-2 ${on ? 'bg-primary' : 'bg-surface border border-line'}`}
              >
                <Text className={`text-sm font-sans-semibold ${on ? 'text-white' : 'text-muted'}`}>{f.key}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable onPress={() => setShowArchived((s) => !s)} className="self-start mb-3">
          <Text className="font-sans-semibold text-xs text-muted underline">
            {showArchived ? 'Masquer les entrées archivées' : 'Afficher les entrées archivées'}
          </Text>
        </Pressable>

        {visibleRecords.length === 0 ? (
          <View className="bg-surface border border-line rounded-3xl p-6 items-center mb-6">
            <Text className="font-sans-semibold text-ink text-center">Aucun élément pour le moment</Text>
          </View>
        ) : (
          visibleRecords.map((r) => {
            const meta = RECORD_KIND_META[r.kind];
            return (
              <Pressable
                key={r.id}
                onPress={() => router.push(`/patient/record-form?patientId=${id}&recordId=${r.id}`)}
                style={{ opacity: r.status === 'inactive' ? 0.5 : 1 }}
              >
                <Card className="mb-3 flex-row items-center">
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
                    <Text className="font-sans text-xs text-muted mt-0.5">{r.date}</Text>
                  </View>
                  {r.attachments.length > 0 ? <Badge label={`${r.attachments.length} pièce(s)`} tone="slate" /> : null}
                </Card>
              </Pressable>
            );
          })
        )}

        <SectionTitle>Historique des consultations</SectionTitle>
        {(consultations ?? []).length === 0 ? (
          <View className="bg-surface border border-line rounded-3xl p-6 items-center">
            <Text className="font-sans-semibold text-ink text-center">Aucune consultation pour le moment</Text>
          </View>
        ) : (
          (consultations ?? []).map((c) => (
            <Card key={c.id} className="mb-3">
              <Text className="font-sans-bold text-ink">{c.reason || 'Consultation'}</Text>
              <Text className="font-sans text-xs text-muted mt-0.5">{c.dateLabel}</Text>
            </Card>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
