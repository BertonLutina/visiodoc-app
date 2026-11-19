import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Plus } from 'lucide-react-native';
import { Avatar, Badge, Card, SectionTitle } from '@/components/ui';
import { colors } from '@/theme/colors';
import { useAsync } from '@/hooks/useAsync';
import { getPatient, getPatientConsultationHistory } from '@/services/providerApi';
import { calculateChildAge, checkChildRecordAccess, getChild } from '@/services/childrenApi';
import { genderLabel } from '@/services/registration';
import { getMedicalRecords } from '@/services/patientApi';
import { currentProvider } from '@/data/mockProvider';
import { useAuth } from '@/contexts/AuthContext';
import { RECORD_KIND_META, RECORD_KINDS } from '@/services/medicalRecordTaxonomy';
import type { MedicalRecordKind } from '@/types';
import { useLanguage, useT } from '@/i18n';

export default function PatientProfile() {
  const t = useT();
  const { code: lang } = useLanguage();
  const { id, childId: childIdParam } = useLocalSearchParams<{ id: string; childId?: string }>();
  // Fiche d'un ENFANT (childId) ou du parent seul : jamais les deux dans le même écran.
  const childId = childIdParam || null;
  const { user } = useAuth();
  const doctorId = user?.id ?? currentProvider.id;
  const [activeFilter, setActiveFilter] = useState('Tout');
  const [showArchived, setShowArchived] = useState(false);

  // `error` est lu explicitement : un refus RLS ne doit jamais s'afficher comme un dossier
  // vide (en clinique, « aucune allergie connue » et « lecture impossible » ne sont pas la
  // même information).
  const { data: adult, error: adultError, reload: reloadAdult } = useAsync(
    () => (childId ? Promise.resolve(null) : getPatient(id)),
    [id, childId],
  );
  const { data: child, error: childError, reload: reloadChild } = useAsync(
    () => (childId ? getChild(childId) : Promise.resolve(null)),
    [childId],
  );
  // Accès au dossier de l'enfant : un accès retiré par le parent prévaut sur la consultation.
  const { data: childAccess } = useAsync(
    () => (childId ? checkChildRecordAccess(doctorId, childId) : Promise.resolve({ hasAccess: true, isRevoked: false })),
    [doctorId, childId],
  );
  const accessRevoked = !!childId && childAccess?.isRevoked === true;
  const patient = useMemo(() => {
    if (!childId) return adult;
    if (!child) return null;
    return {
      id: child.id,
      firstName: child.firstName,
      lastName: child.lastName,
      initials: `${child.firstName.charAt(0)}${child.lastName.charAt(0)}`.toUpperCase(),
      age: calculateChildAge(child.dateOfBirth),
      gender: child.gender,
      bloodType: child.bloodType,
      allergiesSummary: child.allergies,
      address: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
    };
  }, [adult, child, childId]);
  const patientError = childId ? childError : adultError;
  const reloadPatient = childId ? reloadChild : reloadAdult;
  const { data: records, error: recordsError, reload: reloadRecords } = useAsync(
    () => (accessRevoked ? Promise.resolve([]) : getMedicalRecords(id, { childId })),
    [id, childId, lang, accessRevoked],
  );
  const { data: consultations, error: consultationsError } = useAsync(
    () => getPatientConsultationHistory(doctorId, id, { childId }),
    [doctorId, id, childId, lang],
  );

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
          <Text className="font-sans-bold text-lg text-ink">{t('Fiche patient')}</Text>
        </View>
        <Pressable
          onPress={() => router.push(`/patient/record-form?patientId=${id}${childId ? `&childId=${childId}` : ''}`)}
          className="flex-row items-center bg-primary px-3.5 py-2 rounded-2xl"
        >
          <Plus color={colors.white} size={16} />
          <Text className="font-sans-bold text-white text-sm ml-1">{t('Ajouter')}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
        {patientError ? (
          <View className="bg-surface border border-line rounded-3xl p-6 items-center mb-4">
            <Text className="font-sans-semibold text-ink text-center">
              {t('Erreur de chargement de la fiche patient. Réessayez.')}
            </Text>
          </View>
        ) : null}

        <View className="items-center mb-6">
          <Avatar initials={patient?.initials ?? '?'} size={80} tone="light" />
          <Text className="font-serif-bold text-2xl text-ink mt-3">
            {patient ? `${patient.firstName} ${patient.lastName}` : childId ? t('Enfant') : t('Patient')}
          </Text>
          {childId && patient ? (
            <Text className="font-sans text-xs text-clay mt-1">{t('Profil santé déclaré par le parent')}</Text>
          ) : null}
          {patient && (
            <Text className="font-sans text-sm text-muted mt-0.5">
              {patient.age !== null ? `${patient.age} ${t('ans')}` : t('Âge inconnu')}
              {` · ${genderLabel(patient.gender)}`}
              {patient.bloodType ? ` · ${patient.bloodType}` : ''}
            </Text>
          )}
          {patient?.allergiesSummary ? (
            <View className="mt-2 bg-red-50 px-3 py-1.5 rounded-full">
              <Text className="font-sans-bold text-xs text-danger">{t('⚠ Allergies :')} {patient.allergiesSummary}</Text>
            </View>
          ) : null}
          {patient?.emergencyContactName ? (
            <View className="mt-3 items-center">
              <Text className="font-sans text-xs text-muted">{t("Contact d'urgence")}</Text>
              <Text className="font-sans-semibold text-sm text-ink mt-0.5">
                {patient.emergencyContactName}
                {patient.emergencyContactPhone ? ` · ${patient.emergencyContactPhone}` : ''}
              </Text>
            </View>
          ) : null}
        </View>

        <SectionTitle>{t('Historique médical')}</SectionTitle>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3">
          {kindFilters.map((f) => {
            const on = f.key === activeFilter;
            return (
              <Pressable
                key={f.key}
                onPress={() => setActiveFilter(f.key)}
                className={`px-4 py-2 rounded-full mr-2 ${on ? 'bg-primary' : 'bg-surface border border-line'}`}
              >
                <Text className={`text-sm font-sans-semibold ${on ? 'text-white' : 'text-muted'}`}>{t(f.key)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable onPress={() => setShowArchived((s) => !s)} className="self-start mb-3">
          <Text className="font-sans-semibold text-xs text-muted underline">
            {showArchived ? t('Masquer les entrées archivées') : t('Afficher les entrées archivées')}
          </Text>
        </Pressable>

        {accessRevoked ? (
          <View className="bg-surface border border-line rounded-3xl p-6 items-center mb-6">
            <Text className="font-sans-semibold text-ink text-center">
              {t("Le parent a retiré l'accès au dossier de l'enfant.")}
            </Text>
          </View>
        ) : recordsError ? (
          <View className="bg-surface border border-line rounded-3xl p-6 items-center mb-6">
            <Text className="font-sans-semibold text-ink text-center">{t('Erreur de chargement. Réessayez.')}</Text>
          </View>
        ) : visibleRecords.length === 0 ? (
          <View className="bg-surface border border-line rounded-3xl p-6 items-center mb-6">
            <Text className="font-sans-semibold text-ink text-center">{t('Aucun élément pour le moment')}</Text>
          </View>
        ) : (
          visibleRecords.map((r) => {
            const meta = RECORD_KIND_META[r.kind];
            return (
              <Pressable
                key={r.id}
                onPress={() => router.push(`/patient/record-form?patientId=${id}&recordId=${r.id}${childId ? `&childId=${childId}` : ''}`)}
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
                      {t(meta.label)}
                    </Text>
                    <Text className="font-sans-bold text-ink mt-0.5">{r.title}</Text>
                    <Text className="font-sans text-xs text-muted mt-0.5">{r.date}</Text>
                  </View>
                  {r.attachments.length > 0 ? <Badge label={t('{n} pièce(s)', { n: r.attachments.length })} tone="slate" /> : null}
                </Card>
              </Pressable>
            );
          })
        )}

        <SectionTitle>{t('Historique des consultations')}</SectionTitle>
        {consultationsError ? (
          <View className="bg-surface border border-line rounded-3xl p-6 items-center">
            <Text className="font-sans-semibold text-ink text-center">{t('Erreur de chargement. Réessayez.')}</Text>
          </View>
        ) : (consultations ?? []).length === 0 ? (
          <View className="bg-surface border border-line rounded-3xl p-6 items-center">
            <Text className="font-sans-semibold text-ink text-center">{t('Aucune consultation pour le moment')}</Text>
          </View>
        ) : (
          (consultations ?? []).map((c) => (
            <Card key={c.id} className="mb-3">
              <Text className="font-sans-bold text-ink">{c.reason || t('Consultation')}</Text>
              <Text className="font-sans text-xs text-muted mt-0.5">{c.dateLabel}</Text>
            </Card>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
