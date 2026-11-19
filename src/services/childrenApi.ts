import { supabase, supabaseConfigured } from '@/lib/supabase';
import { translate } from '@/i18n/core';
import type {
  AddChildInput,
  ChildDoctorAccess,
  ChildGender,
  ChildHealthProfileInput,
  ChildMeasurements,
  PatientChild,
} from '@/types/children';
import { CHILD_BLOOD_TYPES } from '@/types/children';

const useMock = () => !supabaseConfigured || !supabase;

/**
 * Versions des textes de déclaration et de consentement (MOB-1311-1 §1). Textes provisoires relus par Yves avant
 * la production : à changer ICI seulement, jamais en dur dans un écran.
 */
export const CHILD_DECLARATION_VERSION = 'provisoire-2026-11-13';
export const CHILD_CONSENT_VERSION = 'provisoire-2026-11-13';

/* ---------- Règles pures ---------- */

/** Âge en années révolues à `atDate` ; `null` si la date est absente ou illisible. */
export function calculateChildAge(dateOfBirth: string | null | undefined, atDate: Date = new Date()): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(`${dateOfBirth.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(dob.getTime())) return null;
  let age = atDate.getFullYear() - dob.getFullYear();
  const m = atDate.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && atDate.getDate() < dob.getDate())) age--;
  return Math.max(0, age);
}

/** Un enfant a moins de 18 ans révolus ; une date future est refusée. */
export function isValidChildBirthDate(dateOfBirth: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return false;
  const dob = new Date(`${dateOfBirth}T00:00:00`);
  if (Number.isNaN(dob.getTime())) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (dob.getTime() > today.getTime()) return false;
  const age = calculateChildAge(dateOfBirth, now);
  return age !== null && age < 18;
}

/** Bornes du serveur (MOB-1311-1 §2) : poids 0,3 à 250 kg, taille 25 à 230 cm. */
export const WEIGHT_RANGE_KG = { min: 0.3, max: 250 } as const;
export const HEIGHT_RANGE_CM = { min: 25, max: 230 } as const;

/** Saisie texte (virgule ou point) vers nombre ; `null` si vide ; `NaN` si illisible. */
export function parseMeasurementInput(text: string | null | undefined): number | null {
  const raw = (text ?? '').trim().replace(',', '.');
  if (raw === '') return null;
  return /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
}

export const CHILD_ERROR_CODES = [
  'child_must_be_under_18',
  'invalid_name',
  'invalid_gender',
  'acceptance_required',
  'too_many_children',
  'rate_limited',
  'patients_only',
  'not_authenticated',
  'child_not_found',
  'provider_does_not_accept_children',
  'child_is_immutable',
  'measurement_out_of_range',
  'measurement_required',
  'not_allowed',
  'invalid_health_text',
  'invalid_blood_type',
  'doctor_not_found',
  'doctor_has_not_consulted_child',
  'invalid_expiry',
  'too_many_entries',
  'child_scope_mismatch',
] as const;

export type ChildErrorCode = (typeof CHILD_ERROR_CODES)[number];

/** Code connu contenu dans l'erreur renvoyée par le serveur (ou par la validation locale), sinon `null`. */
export function childErrorCode(error: unknown): ChildErrorCode | null {
  const message =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object'
        ? String((error as { message?: unknown }).message ?? '')
        : '';
  return CHILD_ERROR_CODES.find((code) => message.includes(code)) ?? null;
}

/** Erreur de réservation/écriture dont le message est déjà traduit et affichable tel quel. */
export class ChildBookingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChildBookingError';
  }
}

/** Message affichable pour un code connu (texte traduit, jamais le texte brut du serveur). */
export function childErrorText(code: ChildErrorCode): string {
  switch (code) {
    case 'child_must_be_under_18':
      return translate("L'enfant doit avoir moins de 18 ans.");
    case 'invalid_name':
      return translate('Le nom et le prénom sont invalides (1 à 80 caractères, sans caractères spéciaux).');
    case 'invalid_gender':
      return translate('Le genre doit être masculin ou féminin.');
    case 'acceptance_required':
      return translate('Veuillez accepter la déclaration de représentant légal et le consentement.');
    case 'too_many_children':
      return translate("Vous avez atteint le nombre maximal d'enfants actifs (10 enfants).");
    case 'rate_limited':
      return translate('Trop de tentatives. Veuillez réessayer plus tard.');
    case 'patients_only':
      return translate('Seuls les patients peuvent effectuer cette action.');
    case 'not_authenticated':
      return translate('Veuillez vous connecter pour continuer.');
    case 'child_not_found':
      return translate('Enfant introuvable ou inactif sur votre compte.');
    case 'provider_does_not_accept_children':
      return translate("Ce professionnel n'accepte pas les consultations pour des enfants.");
    case 'child_is_immutable':
      return translate('Le bénéficiaire de la consultation ne peut plus être modifié.');
    case 'measurement_out_of_range':
      return translate('Les mesures sont hors des limites acceptées (poids 0,3 à 250 kg, taille 25 à 230 cm).');
    case 'measurement_required':
      return translate('Renseignez au moins le poids ou la taille.');
    case 'not_allowed':
      return translate('Action non autorisée.');
    case 'invalid_health_text':
      return translate('Le texte dépasse la limite autorisée (1000 caractères maximum).');
    case 'invalid_blood_type':
      return translate('Le groupe sanguin sélectionné est invalide.');
    case 'doctor_not_found':
      return translate('Prestataire introuvable.');
    case 'doctor_has_not_consulted_child':
      return translate("Ce médecin n'a aucune consultation confirmée pour cet enfant.");
    case 'invalid_expiry':
      return translate("La date d'expiration de l'accès est invalide.");
    case 'too_many_entries':
      return translate("Trop de modifications d'accès effectuées. Veuillez réessayer plus tard.");
    case 'child_scope_mismatch':
      return translate('Ce relevé ne correspond pas à la personne de la consultation.');
  }
}

/**
 * Message à afficher pour une erreur liée aux enfants. Une erreur inconnue donne un message générique : le texte
 * brut n'est jamais affiché, et seul le code technique (jamais de nom d'enfant ni de donnée de santé) est journalisé.
 */
export function childErrorMessage(error: unknown): string {
  const code = childErrorCode(error);
  if (code) return childErrorText(code);
  const raw = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  console.warn('[enfants] erreur non reconnue', typeof raw === 'string' ? raw : 'inconnue');
  return translate('Une erreur est survenue. Réessayez plus tard.');
}

export function validateMeasurements(
  weightKg: number | null | undefined,
  heightCm: number | null | undefined,
  options: { required: boolean },
): ChildErrorCode | null {
  const hasWeight = weightKg !== null && weightKg !== undefined;
  const hasHeight = heightCm !== null && heightCm !== undefined;
  if (options.required && !hasWeight && !hasHeight) return 'measurement_required';
  if (hasWeight && !(weightKg >= WEIGHT_RANGE_KG.min && weightKg <= WEIGHT_RANGE_KG.max)) {
    return 'measurement_out_of_range';
  }
  if (hasHeight && !(heightCm >= HEIGHT_RANGE_CM.min && heightCm <= HEIGHT_RANGE_CM.max)) {
    return 'measurement_out_of_range';
  }
  return null;
}

/** Contrôle local avant l'appel serveur ; renvoie le code de la première règle violée. */
export function validateChildInput(input: AddChildInput, now: Date = new Date()): ChildErrorCode | null {
  const validName = (v: string) => {
    const s = v.trim();
    return s.length >= 1 && s.length <= 80 && !/[\u0000-\u001f\u007f<>]/.test(s);
  };
  if (!validName(input.firstName) || !validName(input.lastName)) return 'invalid_name';
  if (!isValidChildBirthDate(input.dateOfBirth, now)) return 'child_must_be_under_18';
  if (input.gender !== 'male' && input.gender !== 'female') return 'invalid_gender';
  if (!input.declarationAccepted || !input.consentAccepted) return 'acceptance_required';
  return validateMeasurements(input.weightKg, input.heightCm, { required: false });
}

/** Avertissement NON bloquant pour des valeurs peu plausibles (mêmes seuils que le web). */
export function measurementPlausibilityWarning(
  ageYears: number | null,
  weightKg: number | null | undefined,
  heightCm: number | null | undefined,
): string | null {
  const young = ageYears !== null && ageYears < 10;
  if (weightKg !== null && weightKg !== undefined && !Number.isNaN(weightKg)) {
    if (weightKg < 2 || weightKg > 120) return translate('Ce poids semble inhabituel. Vérifiez la valeur.');
    if (young && weightKg > 60) return translate("Ce poids semble élevé pour l'âge de l'enfant. Vérifiez la valeur.");
  }
  if (heightCm !== null && heightCm !== undefined && !Number.isNaN(heightCm)) {
    if (heightCm < 40 || heightCm > 200) return translate('Cette taille semble inhabituelle. Vérifiez la valeur.');
    if (young && heightCm > 170) return translate("Cette taille semble élevée pour l'âge de l'enfant. Vérifiez la valeur.");
  }
  return null;
}

/** « saisi aujourd'hui / il y a 12 jours / il y a 3 mois / il y a 2 an(s) ». */
export function measurementAgeText(measuredAt: string | null | undefined, now: Date = new Date()): string {
  if (!measuredAt) return '';
  const date = new Date(measuredAt);
  if (Number.isNaN(date.getTime())) return '';
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (days < 1) return translate("saisi aujourd'hui");
  if (days < 30) return translate('saisi il y a {days} jours', { days });
  const months = Math.floor(days / 30);
  if (months < 12) return translate('saisi il y a {months} mois', { months });
  return translate('saisi il y a {years} an(s)', { years: Math.floor(days / 365) });
}

/**
 * Dernières mesures à partir des lignes (déjà triées de la plus récente à la plus ancienne). Le dernier poids et
 * la dernière taille se lisent séparément ; la date affichée est la plus ancienne des deux.
 */
export function latestMeasurements(
  rows: { weight_kg?: number | string | null; height_cm?: number | string | null; measured_at: string }[],
): ChildMeasurements | null {
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
  const withWeight = rows.find((r) => num(r.weight_kg) !== null);
  const withHeight = rows.find((r) => num(r.height_cm) !== null);
  if (!withWeight && !withHeight) return null;
  const dates = [withWeight?.measured_at, withHeight?.measured_at].filter((d): d is string => !!d);
  const oldest = dates.reduce((a, b) => (new Date(a) <= new Date(b) ? a : b));
  return {
    weightKg: withWeight ? num(withWeight.weight_kg) : null,
    heightCm: withHeight ? num(withHeight.height_cm) : null,
    weightMeasuredAt: withWeight?.measured_at ?? null,
    heightMeasuredAt: withHeight?.measured_at ?? null,
    measuredAt: oldest,
  };
}

/* ---------- Correspondance des lignes ---------- */

const normalizeChildGender = (v: unknown): ChildGender | null => (v === 'male' || v === 'female' ? v : null);

export function mapChildRow(row: any): PatientChild {
  return {
    id: row.id,
    parentUserId: row.parent_user_id ?? '',
    firstName: row.first_name ?? '',
    lastName: row.last_name ?? '',
    dateOfBirth: String(row.date_of_birth ?? '').slice(0, 10),
    gender: normalizeChildGender(row.gender),
    allergies: row.allergies ?? null,
    chronicConditions: row.chronic_conditions ?? null,
    currentMedications: row.current_medications ?? null,
    bloodType: row.blood_type ?? null,
    healthProfileUpdatedAt: row.health_profile_updated_at ?? null,
  };
}

export { normalizeChildGender };

const CHILD_COLUMNS =
  'id, parent_user_id, first_name, last_name, date_of_birth, gender, allergies, chronic_conditions, current_medications, blood_type, health_profile_updated_at';

/* ---------- Lectures (table en lecture seule) ---------- */

/** Enfants actifs du parent connecté (la RLS limite déjà aux siens). */
export async function listPatientChildren(): Promise<PatientChild[]> {
  if (useMock()) return [];
  const { data, error } = await supabase!
    .from('patient_children')
    .select(CHILD_COLUMNS)
    .eq('is_active', true)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapChildRow);
}

export async function getChild(childId: string): Promise<PatientChild | null> {
  if (useMock()) return null;
  const { data, error } = await supabase!.from('patient_children').select(CHILD_COLUMNS).eq('id', childId).maybeSingle();
  if (error) throw error;
  return data ? mapChildRow(data) : null;
}

export async function getLatestChildMeasurements(childId: string): Promise<ChildMeasurements | null> {
  if (useMock()) return null;
  const { data, error } = await supabase!
    .from('patient_child_measurements')
    .select('weight_kg, height_cm, measured_at')
    .eq('child_id', childId)
    .order('measured_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return latestMeasurements((data ?? []) as any[]);
}

/* ---------- Écritures : UNIQUEMENT par RPC ---------- */

/**
 * Ajoute un enfant (`add_patient_child`). Le contrôle local évite l'appel pour un adulte, une date future ou des
 * cases non cochées ; le serveur refait les mêmes contrôles. Rappelée avec les mêmes données, la fonction
 * renvoie le même `id`.
 */
export async function addPatientChild(input: AddChildInput): Promise<string> {
  const invalid = validateChildInput(input);
  if (invalid) throw new Error(invalid);
  if (useMock()) return 'mock-child';
  const { data, error } = await supabase!.rpc('add_patient_child', {
    p_first_name: input.firstName.trim(),
    p_last_name: input.lastName.trim(),
    p_date_of_birth: input.dateOfBirth,
    p_gender: input.gender,
    p_declaration_version: CHILD_DECLARATION_VERSION,
    p_consent_version: CHILD_CONSENT_VERSION,
    p_weight_kg: input.weightKg ?? null,
    p_height_cm: input.heightCm ?? null,
  });
  if (error) throw error;
  return data as string;
}

/** Ajoute une mesure datée (`record_child_measurement`) : poids et taille optionnels, au moins un des deux. */
export async function recordChildMeasurement(
  childId: string,
  weightKg: number | null,
  heightCm: number | null,
  consultationId: string | null = null,
): Promise<string> {
  const invalid = validateMeasurements(weightKg, heightCm, { required: true });
  if (invalid) throw new Error(invalid);
  if (useMock()) return 'mock-measurement';
  const { data, error } = await supabase!.rpc('record_child_measurement', {
    p_child_id: childId,
    p_weight_kg: weightKg,
    p_height_cm: heightCm,
    p_consultation_id: consultationId,
  });
  if (error) throw error;
  return data as string;
}

/** Profil santé déclaré par le parent (`update_child_health_profile`) : les QUATRE champs sont envoyés. */
export async function updateChildHealthProfile(childId: string, input: ChildHealthProfileInput): Promise<void> {
  if (input.bloodType && !(CHILD_BLOOD_TYPES as readonly string[]).includes(input.bloodType)) {
    throw new Error('invalid_blood_type');
  }
  if ([input.allergies, input.chronicConditions, input.currentMedications].some((s) => s.trim().length > 1000)) {
    throw new Error('invalid_health_text');
  }
  if (useMock()) return;
  const { error } = await supabase!.rpc('update_child_health_profile', {
    p_child_id: childId,
    p_allergies: input.allergies.trim() || null,
    p_chronic_conditions: input.chronicConditions.trim() || null,
    p_current_medications: input.currentMedications.trim() || null,
    p_blood_type: input.bloodType.trim() || null,
  });
  if (error) throw error;
}

/* ---------- Accès des médecins au dossier d'un enfant ---------- */

/**
 * Médecins ayant une consultation CONFIRMÉE (`scheduled`, `in_progress`, `completed`) avec cet enfant, avec l'état
 * de leur accès : un accès retiré (ou échu) dans `medical_record_child_consent` prévaut sur la consultation.
 */
export function buildChildDoctorAccess(
  consultations: { doctor_id?: string | null; scheduled_at: string; doctor?: any }[],
  consents: { doctor_id?: string | null; consent_status?: string | null; expires_at?: string | null }[],
  now: Date = new Date(),
): ChildDoctorAccess[] {
  const revoked = new Set<string>();
  for (const c of consents) {
    if (!c.doctor_id) continue;
    const expired = c.expires_at ? new Date(c.expires_at) < now : false;
    if (c.consent_status === 'revoked' || expired) revoked.add(c.doctor_id);
  }
  const seen = new Map<string, ChildDoctorAccess>();
  for (const row of consultations) {
    if (!row.doctor_id || seen.has(row.doctor_id)) continue;
    const doc = Array.isArray(row.doctor) ? row.doctor[0] : row.doctor;
    const spec = doc?.specialization;
    seen.set(row.doctor_id, {
      doctorId: row.doctor_id,
      firstName: doc?.first_name ?? '',
      lastName: doc?.last_name ?? '',
      specialization:
        typeof spec === 'string' ? spec : Array.isArray(spec) ? spec.filter((s) => typeof s === 'string').join(' · ') : '',
      lastConsultationAt: row.scheduled_at,
      revoked: revoked.has(row.doctor_id),
    });
  }
  return [...seen.values()];
}

export async function listChildDoctorAccess(childId: string, patientId: string): Promise<ChildDoctorAccess[]> {
  if (useMock()) return [];
  const [consultations, consents] = await Promise.all([
    supabase!
      .from('consultations')
      .select('doctor_id, scheduled_at, status, doctor:provider_identity!doctor_id ( id, first_name, last_name, specialization )')
      .eq('patient_id', patientId)
      .eq('child_id', childId)
      .in('status', ['scheduled', 'in_progress', 'completed'])
      .order('scheduled_at', { ascending: false }),
    supabase!.from('medical_record_child_consent').select('doctor_id, consent_status, expires_at').eq('child_id', childId),
  ]);
  if (consultations.error) throw consultations.error;
  if (consents.error) throw consents.error;
  return buildChildDoctorAccess((consultations.data ?? []) as any[], (consents.data ?? []) as any[]);
}

/**
 * Accès d'un médecin au dossier d'un enfant selon sa ligne de medical_record_child_consent. Sans ligne, l'accès est
 * automatique (consultation confirmée) ; un accès retiré ou échu est refusé et prévaut sur la consultation.
 */
export function evaluateChildRecordAccess(
  row: { consent_status?: string | null; expires_at?: string | null } | null,
  now: Date = new Date(),
): { hasAccess: boolean; isRevoked: boolean } {
  if (!row) return { hasAccess: true, isRevoked: false };
  if (row.consent_status === 'revoked') return { hasAccess: false, isRevoked: true };
  if (row.expires_at && new Date(row.expires_at) < now) return { hasAccess: false, isRevoked: true };
  return { hasAccess: true, isRevoked: false };
}

/** Lecture côté prestataire ; en cas d'erreur de lecture, l'accès n'est PAS présumé. */
export async function checkChildRecordAccess(doctorId: string, childId: string): Promise<{ hasAccess: boolean; isRevoked: boolean }> {
  if (useMock()) return { hasAccess: true, isRevoked: false };
  const { data, error } = await supabase!
    .from('medical_record_child_consent')
    .select('consent_status, expires_at')
    .eq('doctor_id', doctorId)
    .eq('child_id', childId)
    .maybeSingle();
  if (error) return { hasAccess: false, isRevoked: false };
  return evaluateChildRecordAccess(data);
}

export async function revokeChildRecordConsent(childId: string, doctorId: string): Promise<void> {
  if (useMock()) return;
  const { error } = await supabase!.rpc('revoke_child_record_consent', { p_child_id: childId, p_doctor_id: doctorId });
  if (error) throw error;
}

export async function grantChildRecordConsent(childId: string, doctorId: string, expiresAt: string | null = null): Promise<void> {
  if (useMock()) return;
  const { error } = await supabase!.rpc('grant_child_record_consent', {
    p_child_id: childId,
    p_doctor_id: doctorId,
    p_expires_at: expiresAt,
  });
  if (error) throw error;
}
