import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { Button, Field } from '@/components/ui';
import { DateField } from '@/components/DateField';
import { GenderField } from '@/components/GenderField';
import { colors } from '@/theme/colors';
import {
  addPatientChild,
  calculateChildAge,
  childErrorMessage,
  measurementPlausibilityWarning,
  parseMeasurementInput,
} from '@/services/childrenApi';
import type { Gender } from '@/services/registration';
import { useT } from '@/i18n';

function CheckRow({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      className="flex-row items-start mb-3"
    >
      <View
        className={`w-6 h-6 rounded-md border items-center justify-center mr-3 mt-0.5 ${
          checked ? 'bg-primary border-primary' : 'bg-surface border-line'
        }`}
      >
        {checked ? <Check color={colors.white} size={16} strokeWidth={3} /> : null}
      </View>
      <Text className="flex-1 font-sans text-sm text-ink">{label}</Text>
    </Pressable>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Formulaire d'ajout d'un enfant (MOB-1311-1 §1). Deux cases OBLIGATOIRES, décochées par défaut, séparées :
 * déclaration de représentant légal, puis consentement au partage des données de santé. L'enregistrement passe
 * uniquement par la RPC `add_patient_child` (voir `childrenApi`).
 */
export function AddChildForm({ onAdded, onCancel }: { onAdded: (childId: string) => void; onCancel?: () => void }) {
  const t = useT();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [declaration, setDeclaration] = useState(false);
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = useMemo(() => new Date(), []);
  const oldest = useMemo(() => {
    const d = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate() + 1);
    return d;
  }, [today]);

  const weightKg = parseMeasurementInput(weight);
  const heightCm = parseMeasurementInput(height);
  const warning = measurementPlausibilityWarning(
    calculateChildAge(dateOfBirth),
    weightKg !== null && !Number.isNaN(weightKg) ? weightKg : null,
    heightCm !== null && !Number.isNaN(heightCm) ? heightCm : null,
  );

  const save = async () => {
    if (saving) return;
    setError(null);
    if (Number.isNaN(weightKg) || Number.isNaN(heightCm)) {
      setError(t('Les mesures sont hors des limites acceptées (poids 0,3 à 250 kg, taille 25 à 230 cm).'));
      return;
    }
    setSaving(true);
    try {
      const id = await addPatientChild({
        firstName,
        lastName,
        dateOfBirth,
        gender,
        declarationAccepted: declaration,
        consentAccepted: consent,
        weightKg,
        heightCm,
      });
      onAdded(id);
    } catch (e) {
      setError(childErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View>
      <View className="bg-sand rounded-2xl px-4 py-3 mb-4">
        <Text className="font-sans text-xs text-ink">
          {t("Un enfant est rattaché à un seul compte. L'autre parent doit créer sa propre fiche : l'historique de chaque fiche reste séparé.")}
        </Text>
      </View>

      <Field label={t("Prénom de l'enfant")} value={firstName} onChangeText={setFirstName} maxLength={80} autoCapitalize="words" />
      <Field label={t("Nom de l'enfant")} value={lastName} onChangeText={setLastName} maxLength={80} autoCapitalize="words" />
      <DateField
        label={t('Date de naissance')}
        value={dateOfBirth}
        onChange={setDateOfBirth}
        minimumDate={oldest}
        maximumDate={today}
        placeholder={t('AAAA-MM-JJ')}
        className="mb-4"
      />
      <GenderField value={gender} onChange={setGender} />
      <Field
        label={t('Poids (kg), facultatif')}
        value={weight}
        onChangeText={setWeight}
        keyboardType="decimal-pad"
        placeholder="18,5"
      />
      <Field
        label={t('Taille (cm), facultatif')}
        value={height}
        onChangeText={setHeight}
        keyboardType="decimal-pad"
        placeholder="110"
      />
      {warning ? (
        <View className="bg-amber-50 rounded-2xl px-4 py-3 mb-4">
          <Text className="font-sans text-xs text-amber-700">{warning}</Text>
        </View>
      ) : null}

      <CheckRow
        checked={declaration}
        onToggle={() => setDeclaration((v) => !v)}
        label={t('Je suis le parent ou le représentant légal de cet enfant')}
      />
      <CheckRow
        checked={consent}
        onToggle={() => setConsent((v) => !v)}
        label={t("J'accepte que les données de santé de mon enfant soient traitées par VisioDoc et partagées avec le médecin consulté")}
      />

      {error ? (
        <Text accessibilityRole="alert" className="font-sans-medium text-sm text-danger mb-3">
          {error}
        </Text>
      ) : null}

      <Button label={t("Enregistrer l'enfant")} onPress={save} loading={saving} disabled={saving} />
      {onCancel ? <Button label={t('Annuler')} variant="ghost" className="mt-2" onPress={onCancel} /> : null}
    </View>
  );
}

export { isoDate };
