import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Field } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import {
  childErrorMessage,
  getChild,
  getLatestChildMeasurements,
  measurementAgeText,
  parseMeasurementInput,
  recordChildMeasurement,
} from '@/services/childrenApi';
import type { ConsultationChildInfo } from '@/types/children';
import { useT } from '@/i18n';

/** « Patient : Léa (enfant, 7 ans) · Parent : <nom> » : texte d'en-tête d'une consultation d'enfant. */
export function useChildHeadline() {
  const t = useT();
  return (child: ConsultationChildInfo, parentName: string) =>
    t('Patient : {name} (enfant, {age} ans) · Parent : {parent}', {
      name: child.firstName,
      age: child.ageYears ?? '?',
      parent: parentName,
    });
}

/**
 * Bloc prestataire d'une consultation d'enfant (MOB-1311-1 §5, MOB-1311-2 §6) : profil santé DÉCLARÉ PAR LE PARENT
 * pour cet enfant (jamais celui du parent), derniers poids et taille avec leur date, et correction possible par
 * `record_child_measurement` liée à la consultation.
 */
export function ChildConsultationInfo({
  child,
  parentName,
  consultationId,
}: {
  child: ConsultationChildInfo;
  parentName: string;
  consultationId: string;
}) {
  const t = useT();
  const headline = useChildHeadline();
  const profileReq = useAsync(() => getChild(child.id), [child.id]);
  const measuresReq = useAsync(() => getLatestChildMeasurements(child.id), [child.id]);
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const profile = profileReq.data;
  const m = measuresReq.data;

  const save = async () => {
    const w = parseMeasurementInput(weight);
    const h = parseMeasurementInput(height);
    setMessage(null);
    if (Number.isNaN(w) || Number.isNaN(h)) {
      setMessage(childErrorMessage('measurement_out_of_range'));
      return;
    }
    setSaving(true);
    try {
      await recordChildMeasurement(child.id, w, h, consultationId);
      setWeight('');
      setHeight('');
      measuresReq.reload();
    } catch (e) {
      setMessage(childErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="mt-3 bg-sand rounded-2xl px-4 py-3">
      <Text className="font-sans-bold text-sm text-ink">{headline(child, parentName)}</Text>

      <Text className="font-sans text-xs text-muted mt-2">
        {m?.weightKg != null ? `${m.weightKg} kg` : t('Poids inconnu')}
        {' · '}
        {m?.heightCm != null ? `${m.heightCm} cm` : t('Taille inconnue')}
        {m?.measuredAt ? ` (${measurementAgeText(m.measuredAt)})` : ''}
      </Text>

      <Text className="font-sans-semibold text-xs text-ink mt-3">{t("Profil santé de l'enfant (déclaré par le parent)")}</Text>
      {profileReq.error ? (
        <Text className="font-sans text-xs text-muted mt-1">{t('Erreur de chargement. Réessayez.')}</Text>
      ) : (
        <>
          <Text className="font-sans text-xs text-muted mt-1">
            {t('Allergies')} : {profile?.allergies || t('Non renseigné')}
          </Text>
          <Text className="font-sans text-xs text-muted">
            {t('Maladies chroniques')} : {profile?.chronicConditions || t('Non renseigné')}
          </Text>
          <Text className="font-sans text-xs text-muted">
            {t('Traitements en cours')} : {profile?.currentMedications || t('Non renseigné')}
          </Text>
          <Text className="font-sans text-xs text-muted">
            {t('Groupe sanguin')} : {profile?.bloodType || t('Non renseigné')}
          </Text>
        </>
      )}

      <Text className="font-sans-semibold text-xs text-ink mt-3 mb-1">{t('Corriger le poids ou la taille')}</Text>
      <View className="flex-row">
        <View className="flex-1 mr-2">
          <Field label={t('Poids (kg)')} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" className="mb-2" />
        </View>
        <View className="flex-1">
          <Field label={t('Taille (cm)')} value={height} onChangeText={setHeight} keyboardType="decimal-pad" className="mb-2" />
        </View>
      </View>
      {message ? <Text className="font-sans text-xs text-danger mb-2">{message}</Text> : null}
      <Button
        label={t('Enregistrer')}
        variant="outline"
        loading={saving}
        disabled={saving || (weight.trim() === '' && height.trim() === '')}
        onPress={save}
      />
    </View>
  );
}
