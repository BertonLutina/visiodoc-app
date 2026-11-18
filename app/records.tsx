import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { Card } from '@/components/ui';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { getMedicalRecords } from '@/services/patientApi';
import { listPatientChildren } from '@/services/childrenApi';
import { belongsToPerson, personScope, type PersonKey } from '@/utils/recordPerson';
import { RECORD_KIND_META, RECORD_KINDS } from '@/services/medicalRecordTaxonomy';
import type { MedicalRecordKind } from '@/types';
import { useLanguage, useT } from '@/i18n';

export default function MedicalRecords() {
  const t = useT();
  const { code: lang } = useLanguage();
  const { user } = useAuth();
  const uid = user?.id ?? 'patient-1';
  const [active, setActive] = useState('Tout');
  // « Moi / Léa / Paul » : les relevés de chaque personne restent séparés.
  const [person, setPerson] = useState<PersonKey>('self');
  const { data: children } = useAsync(() => listPatientChildren(), [uid]);
  const { data: records } = useAsync(
    () => getMedicalRecords(uid, personScope(person)),
    [uid, lang, person],
  );

  const filters = useMemo(
    () => [
      { key: 'Tout', match: undefined as MedicalRecordKind | undefined },
      ...RECORD_KINDS.map((k) => ({ key: RECORD_KIND_META[k].label, match: k })),
    ],
    [],
  );

  const list = useMemo(() => {
    // Une entrée archivée (`status === 'inactive'`) est une information périmée : ne jamais
    // la présenter au patient comme si elle était toujours d'actualité. Pas de bascule côté
    // patient — contrairement à la fiche prestataire, qui a besoin de l'historique complet.
    const all = (records ?? []).filter((r) => r.status !== 'inactive' && belongsToPerson(r, person));
    const f = filters.find((x) => x.key === active);
    if (!f?.match) return all;
    return all.filter((r) => r.kind === f.match);
  }, [active, records, filters, person]);

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2">
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">{t('Dossier médical')}</Text>
      </View>

      {(children ?? []).length > 0 ? (
        <View className="px-5 pb-2">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {[{ key: 'self' as PersonKey, label: t('Moi') }, ...(children ?? []).map((c) => ({ key: c.id as PersonKey, label: c.firstName }))].map((p) => {
              const on = p.key === person;
              return (
                <Pressable
                  key={p.key}
                  onPress={() => setPerson(p.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  className={`px-4 py-2 rounded-full mr-2 ${on ? 'bg-accent' : 'bg-surface border border-line'}`}
                >
                  <Text className={`text-sm font-sans-semibold ${on ? 'text-white' : 'text-muted'}`}>{p.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {person !== 'self' ? (
            <Pressable onPress={() => router.push(`/children/${person}`)} className="self-start mt-2">
              <Text className="font-sans-semibold text-xs text-primary underline">{t('Profil santé et accès des médecins')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

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
                <Text className={`text-sm font-sans-semibold ${on ? 'text-white' : 'text-muted'}`}>{t(f.key)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 12 }}>
        {list.map((r) => {
          const meta = RECORD_KIND_META[r.kind];
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
                  {t(meta.label)}
                </Text>
                <Text className="font-sans-bold text-ink mt-0.5">{r.title}</Text>
                <Text className="font-sans text-xs text-muted mt-0.5">{r.date}</Text>
              </View>
            </Card>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
