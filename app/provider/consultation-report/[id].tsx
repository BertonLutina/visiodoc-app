import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { Button, Card } from '@/components/ui';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/i18n';
import { canWriteReport } from '@/utils/canStart';
import {
  ConsultationReportError,
  endConsultation,
  getConsultationReport,
  saveConsultationReport,
  type ConsultationReport,
  type ReportFields,
} from '@/services/consultationReport';

const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim();

/**
 * Rapport du prestataire (palier 1) : notes, diagnostic et prescription en TEXTE LIBRE (colonnes `consultations.notes`,
 * `diagnosis`, `prescription`, comme le web). Saisie possible pendant ou après l'appel, sans limite de temps.
 * Aucune ordonnance structurée ici. Les contenus ne sont jamais journalisés.
 */
export default function ConsultationReportScreen() {
  const t = useT();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const consultationId = typeof id === 'string' ? id : '';
  const uid = user?.id ?? '';

  const [report, setReport] = useState<ConsultationReport | null>(null);
  const [fields, setFields] = useState<ReportFields>({ notes: '', diagnosis: '', prescription: '' });
  const saved = useRef<ReportFields>({ notes: '', diagnosis: '', prescription: '' });
  const updatedAt = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'end' | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [conflict, setConflict] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setConflict(false);
    setMessage(null);
    try {
      const r = await getConsultationReport(consultationId, uid);
      const f = { notes: r.notes, diagnosis: r.diagnosis, prescription: r.prescription };
      setReport(r);
      setFields(f);
      saved.current = f;
      updatedAt.current = r.updatedAt;
    } catch (e) {
      setLoadError(e instanceof ConsultationReportError ? e.message : t('Opération impossible pour le moment. Vérifie ta connexion et réessaie.'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultationId, uid]);

  useEffect(() => {
    if (consultationId && uid) load();
    else setLoading(false);
  }, [consultationId, uid, load]);

  const editable = report ? canWriteReport(report.status) : false;

  const dirty =
    fields.notes !== saved.current.notes ||
    fields.diagnosis !== saved.current.diagnosis ||
    fields.prescription !== saved.current.prescription;

  const fail = (e: unknown) => {
    if (e instanceof ConsultationReportError) {
      setConflict(e.kind === 'conflict');
      setMessage({ text: e.message, tone: 'error' });
    } else {
      setMessage({ text: t('Opération impossible pour le moment. Vérifie ta connexion et réessaie.'), tone: 'error' });
    }
  };

  /** Retourne true si le rapport est à jour côté serveur. */
  const save = async (): Promise<boolean> => {
    try {
      const r = await saveConsultationReport(consultationId, uid, fields, updatedAt.current);
      updatedAt.current = r.updatedAt;
      saved.current = fields;
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  };

  const onSave = async () => {
    setBusy('save');
    setMessage(null);
    setConflict(false);
    if (await save()) {
      const hh = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setMessage({ text: t('Enregistré à {time}', { time: hh }), tone: 'ok' });
    }
    setBusy(null);
  };

  const onEnd = async () => {
    setBusy('end');
    setMessage(null);
    setConflict(false);
    try {
      if (dirty && !(await save())) return;
      const r = await endConsultation(consultationId, uid);
      updatedAt.current = r.updatedAt;
      setReport((prev) => (prev ? { ...prev, status: 'completed' } : prev));
      setMessage({ text: t('Consultation terminée.'), tone: 'ok' });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const inputClass = 'border border-line rounded-2xl bg-surface px-4 py-3 font-sans text-ink text-base';

  const renderField = (label: string, field: keyof ReportFields) => (
    <View className="mb-4">
      <Text className="font-sans-bold text-ink mb-1.5">{label}</Text>
      <TextInput
        value={fields[field]}
        onChangeText={(v) => setFields((p) => ({ ...p, [field]: v }))}
        multiline
        textAlignVertical="top"
        editable={busy === null && editable}
        className={inputClass}
        style={{ minHeight: field === 'notes' ? 140 : 100 }}
        placeholderTextColor={colors.muted}
        accessibilityLabel={label}
        autoCorrect
      />
    </View>
  );

  const childLine = (() => {
    if (!report?.isChild) return null;
    if (!report.child) return t('Consultation pour un enfant');
    const age = report.child.age != null ? t('enfant, {age} ans', { age: report.child.age }) : t('enfant');
    return `${fullName(report.child)} (${age})`;
  })();

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={goBack} className="p-1 mr-2" accessibilityRole="button" accessibilityLabel={t('Retour')}>
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">{t('Rapport de consultation')}</Text>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : loadError || !report ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="font-sans text-ink text-center">{loadError ?? t('Consultation introuvable ou accès refusé.')}</Text>
          <Pressable onPress={load} className="mt-4 rounded-full bg-primary px-6 py-3" accessibilityRole="button">
            <Text className="text-white font-sans-bold">{t('Réessayer')}</Text>
          </Pressable>
        </View>
      ) : (
        <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8 }} keyboardShouldPersistTaps="handled">
            <Card className="mb-4">
              <Text className="font-sans text-xs text-muted">{t('Patient')}</Text>
              {report.isChild ? (
                <>
                  <Text className="font-sans-bold text-ink mt-0.5">{childLine}</Text>
                  <Text className="font-sans text-xs text-muted mt-1">
                    {t('Représentant : {name}', { name: fullName(report.patient) })}
                  </Text>
                </>
              ) : (
                <Text className="font-sans-bold text-ink mt-0.5">
                  {fullName(report.patient)}
                  {report.patient.age != null ? ` · ${report.patient.age} ${t('ans')}` : ''}
                </Text>
              )}
            </Card>

            {renderField(t('Notes'), 'notes')}
            {renderField(t('Diagnostic'), 'diagnosis')}
            {renderField(t('Prescription (texte libre)'), 'prescription')}

            {editable ? <Text className="font-sans text-xs text-muted mb-4">{t('Astuce : utilise le micro du clavier pour dicter')}</Text> : null}

            {!editable ? (
              <Text className="font-sans text-ink mb-3">
                {t("Le rapport n'est disponible que si le patient s'est connecté (consultation en cours ou terminée).")}
              </Text>
            ) : null}

            {message ? (
              <Text className={`font-sans mb-3 ${message.tone === 'error' ? 'text-red-600' : 'text-ink'}`} accessibilityLiveRegion="polite">
                {message.text}
              </Text>
            ) : null}

            {!editable ? null : conflict ? (
              <Button label={t('Recharger')} variant="outline" onPress={load} className="mb-3" />
            ) : (
              <Button label={t('Enregistrer')} variant="accent" onPress={onSave} loading={busy === 'save'} disabled={busy !== null || !dirty} className="mb-3" />
            )}

            {report.status === 'in_progress' ? (
              <Button
                label={t('Terminer la consultation')}
                variant="outline"
                onPress={onEnd}
                loading={busy === 'end'}
                disabled={busy !== null || conflict}
              />
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}
