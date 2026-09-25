import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Button, Field, SectionTitle } from '@/components/ui';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { getMedicalRecords } from '@/services/patientApi';
import {
  archiveMedicalRecord,
  createMedicalRecord,
  updateMedicalRecord,
  appendMedicalRecordAttachment,
} from '@/services/providerApi';
import { uploadRecordAttachment, type PickedFile } from '@/services/medicalRecordAttachments';
import { RECORD_KIND_META, RECORD_KINDS } from '@/services/medicalRecordTaxonomy';
import { currentProvider } from '@/data/mockProvider';
import type { MedicalRecordKind, MedicalRecordSeverity } from '@/types';

export default function RecordForm() {
  const { patientId, recordId } = useLocalSearchParams<{ patientId: string; recordId?: string }>();
  const { user } = useAuth();
  const doctorId = user?.id ?? currentProvider.id;
  const isEdit = !!recordId;

  const { data: records } = useAsync(() => getMedicalRecords(patientId), [patientId]);
  const existing = useMemo(() => (records ?? []).find((r) => r.id === recordId), [records, recordId]);

  const [kind, setKind] = useState<MedicalRecordKind>('note');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [severity, setSeverity] = useState<MedicalRecordSeverity | undefined>(undefined);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [medicationName, setMedicationName] = useState('');
  const [dosage, setDosage] = useState('');
  const [frequency, setFrequency] = useState('');
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (existing && !hydrated) {
      setKind(existing.kind);
      setTitle(existing.title);
      setDescription(existing.description ?? '');
      setCategory(existing.category ?? '');
      setSeverity(existing.severity);
      setStartDate(existing.startDate ?? '');
      setEndDate(existing.endDate ?? '');
      setMedicationName(existing.metadata?.medication_name ?? '');
      setDosage(existing.metadata?.dosage ?? '');
      setFrequency(existing.metadata?.frequency ?? '');
      setHydrated(true);
    }
  }, [existing, hydrated]);

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setPickedFile({ uri: asset.uri, name: asset.fileName ?? `photo-${Date.now()}.jpg`, mimeType: asset.mimeType ?? 'image/jpeg' });
  };

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setPickedFile({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? 'application/pdf' });
  };

  const buildMetadata = (): Record<string, string> => {
    if (kind !== 'prescription') return {};
    const m: Record<string, string> = {};
    if (medicationName) m.medication_name = medicationName;
    if (dosage) m.dosage = dosage;
    if (frequency) m.frequency = frequency;
    return m;
  };

  const onSave = async () => {
    if (!title.trim()) {
      setError('Le titre est obligatoire.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let id = recordId;
      if (isEdit && id) {
        await updateMedicalRecord(
          id,
          { doctorId, patientId, kind },
          {
            title,
            description: description || undefined,
            category: category || undefined,
            severity,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            metadata: buildMetadata(),
          },
        );
      } else {
        const created = await createMedicalRecord({
          patientId,
          doctorId,
          kind,
          title,
          description: description || undefined,
          category: category || undefined,
          severity,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          metadata: buildMetadata(),
        });
        id = created.id;
      }
      if (pickedFile && id) {
        const attachment = await uploadRecordAttachment(patientId, id, pickedFile);
        await appendMedicalRecordAttachment(id, existing?.attachments ?? [], attachment);
      }
      router.back();
    } catch (e: any) {
      setError(e?.message ?? "Impossible d'enregistrer cette entrée. Réessayez.");
    } finally {
      setSaving(false);
    }
  };

  const onArchive = () => {
    if (!recordId) return;
    Alert.alert('Archiver cette entrée ?', 'Elle restera visible mais masquée par défaut.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Archiver',
        style: 'destructive',
        onPress: async () => {
          try {
            await archiveMedicalRecord(recordId, { doctorId, patientId, kind });
            router.back();
          } catch (e: any) {
            setError(e?.message ?? "Impossible d'archiver cette entrée.");
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2">
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">{isEdit ? "Modifier l'entrée" : 'Nouvelle entrée'}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <SectionTitle>Type</SectionTitle>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4">
          {RECORD_KINDS.map((k) => {
            const on = k === kind;
            return (
              <Pressable
                key={k}
                onPress={() => setKind(k)}
                className={`px-4 py-2 rounded-full mr-2 ${on ? 'bg-primary' : 'bg-surface border border-line'}`}
              >
                <Text className={`text-sm font-sans-semibold ${on ? 'text-white' : 'text-muted'}`}>
                  {RECORD_KIND_META[k].label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Field label="Titre" value={title} onChangeText={setTitle} placeholder="Ex: Paracétamol 1g" />
        <Field label="Description" value={description} onChangeText={setDescription} placeholder="Détails (optionnel)" multiline />
        <Field label="Catégorie" value={category} onChangeText={setCategory} placeholder="Optionnel" />

        <Text className="text-sm font-sans-semibold text-ink mb-2">Gravité (optionnel)</Text>
        <View className="flex-row mb-4">
          {(
            [
              { key: undefined, label: 'Aucune' },
              { key: 'mild', label: 'Légère' },
              { key: 'moderate', label: 'Modérée' },
              { key: 'severe', label: 'Sévère' },
            ] as { key: MedicalRecordSeverity | undefined; label: string }[]
          ).map((opt) => {
            const on = opt.key === severity;
            return (
              <Pressable
                key={opt.label}
                onPress={() => setSeverity(opt.key)}
                className={`px-3.5 py-2 rounded-full mr-2 ${on ? 'bg-primary' : 'bg-surface border border-line'}`}
              >
                <Text className={`text-sm font-sans-semibold ${on ? 'text-white' : 'text-muted'}`}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {kind === 'prescription' ? (
          <>
            <SectionTitle>Détails de l'ordonnance</SectionTitle>
            <Field label="Médicament" value={medicationName} onChangeText={setMedicationName} />
            <Field label="Dosage" value={dosage} onChangeText={setDosage} placeholder="Ex: 500mg" />
            <Field label="Fréquence" value={frequency} onChangeText={setFrequency} placeholder="Ex: 3x/jour" />
          </>
        ) : null}

        <View className="flex-row">
          <Field label="Date de début" value={startDate} onChangeText={setStartDate} placeholder="AAAA-MM-JJ" className="flex-1 mr-2" />
          <Field label="Date de fin" value={endDate} onChangeText={setEndDate} placeholder="AAAA-MM-JJ" className="flex-1 ml-2" />
        </View>

        <SectionTitle>Pièce jointe</SectionTitle>
        <View className="flex-row mb-4">
          <Button label="Photo" variant="outline" onPress={pickPhoto} className="flex-1 mr-2" />
          <Button label="Fichier PDF" variant="outline" onPress={pickDocument} className="flex-1 ml-2" />
        </View>
        {pickedFile ? <Text className="font-sans text-sm text-muted mb-4">Sélectionné : {pickedFile.name}</Text> : null}
        {(existing?.attachments ?? []).map((a) => (
          <Text key={a.path} className="font-sans text-sm text-muted mb-1">
            📎 {a.name}
          </Text>
        ))}

        {error ? <Text className="font-sans-semibold text-sm text-danger mb-4">{error}</Text> : null}

        <Button label="Enregistrer" onPress={onSave} loading={saving} className="mb-3" />
        {isEdit ? <Button label="Archiver" variant="outline" onPress={onArchive} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
