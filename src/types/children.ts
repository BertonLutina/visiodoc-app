// Types « enfants » — alignés sur le backend (MOB-1311-1 / MOB-1311-2). Un enfant a moins de 18 ans révolus.

export type ChildGender = 'male' | 'female';

export const CHILD_BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export type ChildBloodType = (typeof CHILD_BLOOD_TYPES)[number];

/** Ligne de `patient_children` (lecture seule côté client : toute écriture passe par une RPC). */
export interface PatientChild {
  id: string;
  parentUserId: string;
  firstName: string;
  lastName: string;
  /** `AAAA-MM-JJ`. */
  dateOfBirth: string;
  gender: ChildGender | null;
  allergies: string | null;
  chronicConditions: string | null;
  currentMedications: string | null;
  bloodType: string | null;
  healthProfileUpdatedAt: string | null;
}

/**
 * Dernières mesures connues. Le poids et la taille se lisent SÉPARÉMENT : la ligne la plus récente peut ne
 * contenir que l'un des deux (un médecin corrige une seule valeur).
 */
export interface ChildMeasurements {
  weightKg: number | null;
  heightCm: number | null;
  weightMeasuredAt: string | null;
  heightMeasuredAt: string | null;
  /** La plus ancienne des deux dates : une valeur périmée n'est jamais présentée comme récente. */
  measuredAt: string | null;
}

export interface AddChildInput {
  firstName: string;
  lastName: string;
  /** `AAAA-MM-JJ`. */
  dateOfBirth: string;
  gender: ChildGender | null;
  /** Case « je suis le parent ou le représentant légal ». */
  declarationAccepted: boolean;
  /** Case séparée : partage des données de santé avec le médecin consulté. */
  consentAccepted: boolean;
  weightKg?: number | null;
  heightCm?: number | null;
}

/** Profil santé déclaré par le parent (les quatre champs sont toujours envoyés ; vide = effacé). */
export interface ChildHealthProfileInput {
  allergies: string;
  chronicConditions: string;
  currentMedications: string;
  bloodType: string;
}

/** Médecin ayant une consultation confirmée avec l'enfant, avec l'état de son accès au dossier. */
export interface ChildDoctorAccess {
  doctorId: string;
  firstName: string;
  lastName: string;
  specialization: string;
  lastConsultationAt: string;
  revoked: boolean;
}

/** Consultation vue côté prestataire : l'enfant concerné (âge, jamais la date de naissance du parent). */
export interface ConsultationChildInfo {
  id: string;
  firstName: string;
  lastName: string;
  ageYears: number | null;
  gender: ChildGender | null;
}
