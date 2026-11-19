import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { Button, Card, Field, SectionTitle } from '@/components/ui';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import {
  calculateChildAge,
  childErrorMessage,
  getChild,
  grantChildRecordConsent,
  listChildDoctorAccess,
  revokeChildRecordConsent,
  updateChildHealthProfile,
} from '@/services/childrenApi';
import { CHILD_BLOOD_TYPES } from '@/types/children';
import { useT } from '@/i18n';

/**
 * Fiche d'un enfant côté parent : profil santé (update_child_health_profile, les quatre champs) et accès des médecins
 * au dossier de l'enfant (retirer / rétablir par fonction, jamais d'écriture directe).
 */
export default function ChildDetail() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const childReq = useAsync(() => getChild(id), [id]);
  const accessReq = useAsync(() => (user?.id ? listChildDoctorAccess(id, user.id) : Promise.resolve([])), [id, user?.id]);
  const child = childReq.data;

  const [allergies, setAllergies] = useState('');
  const [chronic, setChronic] = useState('');
  const [meds, setMeds] = useState('');
  const [blood, setBlood] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busyDoctor, setBusyDoctor] = useState<string | null>(null);

  useEffect(() => {
    if (!child) return;
    setAllergies(child.allergies ?? '');
    setChronic(child.chronicConditions ?? '');
    setMeds(child.currentMedications ?? '');
    setBlood(child.bloodType ?? '');
  }, [child]);

  const saveProfile = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await updateChildHealthProfile(id, {
        allergies: allergies,
        chronicConditions: chronic,
        currentMedications: meds,
        bloodType: blood,
      });
      setMessage(t('Profil santé enregistré.'));
      childReq.reload();
    } catch (e) {
      setMessage(childErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const changeAccess = async (doctorId: string, revoke: boolean) => {
    setBusyDoctor(doctorId);
    try {
      if (revoke) await revokeChildRecordConsent(id, doctorId);
      else await grantChildRecordConsent(id, doctorId, null);
      accessReq.reload();
    } catch (e) {
      Alert.alert(t('Accès au dossier'), childErrorMessage(e));
    } finally {
      setBusyDoctor(null);
    }
  };

  const confirmRevoke = (doctorId: string) =>
    Alert.alert(t('Retirer l\'accès'), t("Ce médecin ne pourra plus lire le dossier de l'enfant. Vous pourrez le rétablir à tout moment."), [
      { text: t('Annuler'), style: 'cancel' },
      { text: t("Retirer l'accès"), style: 'destructive', onPress: () => void changeAccess(doctorId, true) },
    ]);

  const age = child ? calculateChildAge(child.dateOfBirth) : null;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2">
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">{child ? child.firstName : t('Enfant')}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {childReq.error ? (
          <Text className="font-sans text-sm text-muted text-center mb-4">{t('Erreur de chargement. Réessayez.')}</Text>
        ) : null}
        {child ? (
          <Text className="font-sans text-sm text-muted mb-2">
            {child.firstName} {child.lastName} · {age !== null ? `${age} ${t('ans')}` : t('Âge inconnu')}
          </Text>
        ) : null}

        <SectionTitle>{t('Profil santé')}</SectionTitle>
        <Field label={t('Allergies')} value={allergies} onChangeText={setAllergies} multiline maxLength={1000} />
        <Field label={t('Maladies chroniques')} value={chronic} onChangeText={setChronic} multiline maxLength={1000} />
        <Field label={t('Traitements en cours')} value={meds} onChangeText={setMeds} multiline maxLength={1000} />
        <Text className="text-sm font-sans-semibold text-ink mb-2">{t('Groupe sanguin')}</Text>
        <View className="flex-row flex-wrap mb-4">
          {CHILD_BLOOD_TYPES.map((b) => {
            const on = blood === b;
            return (
              <Pressable
                key={b}
                onPress={() => setBlood(on ? '' : b)}
                className={`px-4 py-2 rounded-full mr-2 mb-2 ${on ? 'bg-primary' : 'bg-surface border border-line'}`}
              >
                <Text className={`text-sm font-sans-semibold ${on ? 'text-white' : 'text-muted'}`}>{b}</Text>
              </Pressable>
            );
          })}
        </View>
        {message ? <Text className="font-sans text-sm text-ink mb-3">{message}</Text> : null}
        <Button label={t('Enregistrer')} onPress={saveProfile} loading={saving} disabled={saving || !child} />

        <SectionTitle className="mt-6">{t('Médecins ayant accès au dossier')}</SectionTitle>
        {accessReq.error ? (
          <Text className="font-sans text-sm text-muted mb-3">{t('Erreur de chargement. Réessayez.')}</Text>
        ) : null}
        {!accessReq.loading && !accessReq.error && (accessReq.data ?? []).length === 0 ? (
          <Text className="font-sans text-sm text-muted">{t("Aucun médecin n'a encore consulté cet enfant.")}</Text>
        ) : null}
        {(accessReq.data ?? []).map((d) => (
          <Card key={d.doctorId} className="mb-3">
            <Text className="font-sans-bold text-ink">
              Dr. {d.firstName} {d.lastName}
            </Text>
            {d.specialization ? <Text className="font-sans text-xs text-muted mt-0.5">{d.specialization}</Text> : null}
            <Text className="font-sans text-xs text-muted mt-0.5">
              {d.revoked ? t('Accès retiré') : t('Accès actif')}
            </Text>
            <Button
              label={d.revoked ? t("Rétablir l'accès") : t("Retirer l'accès")}
              variant="outline"
              className="mt-3"
              disabled={busyDoctor === d.doctorId}
              loading={busyDoctor === d.doctorId}
              onPress={() => (d.revoked ? void changeAccess(d.doctorId, false) : confirmRevoke(d.doctorId))}
            />
          </Card>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
