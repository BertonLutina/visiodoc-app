// Types partagés VisioDoc Mobile — alignés sur le backend Supabase de l'app web.

/** Rôles ouverts sur mobile : tout autre rôle `users.role` est refusé (src/services/accessPolicy.ts). */
export type UserRole = 'patient' | 'provider';

export type ConsultationType = 'video' | 'chat' | 'phone';

export type ConsultationStatus =
  | 'pending'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  phone?: string;
  /** Photo PUBLIQUE approuvée d'un prestataire (users.avatar_url) ; jamais écrite par le client. */
  avatarUrl?: string;
  /** Photo privée validée d'un patient (users.avatar_path), lue par URL signée. */
  avatarPath?: string;
  /** Photo de prestataire en attente de revue (users.avatar_pending_path). */
  avatarPendingPath?: string;
  avatarReviewStatus?: 'pending' | 'approved' | 'rejected';
  /** Motif du refus de la photo (users.avatar_review_note). */
  avatarReviewNote?: string;
  countryCode?: string;
  /** Langue choisie par le patient (parmi celles de son pays), ex: 'Lingala'. */
  preferredLanguage?: string;
  /** Compte actif (médecin validé par l'admin). */
  isActive?: boolean;
  /** Statut médecin, ex: 'VALIDE_ABO_ACTIF', 'PENDING_VALIDATION'… */
  doctorStatus?: string;
}

export interface Doctor {
  id: string;
  firstName: string;
  lastName: string;
  specialty: string;
  city: string;
  /** Tarif ; `null` quand la vue le masque (visiteur, ou tarif non renseigné). */
  fee: number | null;
  /** Code ISO 4217 renvoyé par `public_provider_listing.currency_code` (null si masqué). */
  currencyCode?: string | null;
  rating: number;
  reviewsCount: number;
  yearsOfExperience: number;
  patientsCount: number;
  availabilityLabel?: string; // ex: "Dispo auj." (absent du catalogue liste)
  initials: string;
  /** Photo de profil publique (users.avatar_url). */
  avatarUrl?: string;
}

export interface TimeSlot {
  id: string;
  label: string; // ex: "09h00"
  available: boolean;
}

export interface Consultation {
  id: string;
  doctor: Pick<Doctor, 'id' | 'firstName' | 'lastName' | 'specialty' | 'initials' | 'avatarUrl'>;
  date: string; // ISO ou libellé court
  dateLabel: string; // ex: "Jeu 20 juin · 14h30"
  type: ConsultationType;
  durationMin: number;
  fee: number;
  /** `consultations.currency` (ISO), utile pour repayer une consultation en attente. */
  currency?: string;
  /** `consultations.created_at` (ISO) : âge d'une réservation impayée. */
  createdAt?: string;
  /** `status = 'pending_payment'` : réservée mais pas encore payée, ni confirmée. */
  awaitingPayment?: boolean;
  status: ConsultationStatus;
  roomId?: string;
}

export interface WalletTransaction {
  id: string;
  label: string;
  date: string;
  amount: number; // positif = crédit, négatif = débit
  method?: string;
}

export interface Wallet {
  balance: number;
  currency: string; // ex: "FC" (symbole du pays actif)
  countryLabel: string;
  aiCreditsLeft: number;
  transactions: WalletTransaction[];
}

export type MedicalRecordKind =
  | 'allergy'
  | 'medication'
  | 'condition'
  | 'vaccination'
  | 'lab_result'
  | 'document'
  | 'note'
  | 'prescription'
  | 'consultation_report';

export type MedicalRecordSeverity = 'mild' | 'moderate' | 'severe';
export type MedicalRecordStatus = 'active' | 'inactive' | 'resolved';

export interface MedicalRecordAttachment {
  name: string;
  path: string;
  type: string;
  uploadedAt: string;
}

export interface MedicalRecord {
  id: string;
  patientId: string;
  doctorId: string;
  consultationId?: string;
  kind: MedicalRecordKind;
  title: string;
  description?: string;
  category?: string;
  severity?: MedicalRecordSeverity;
  status: MedicalRecordStatus;
  author: string;
  date: string;
  startDate?: string;
  endDate?: string;
  attachments: MedicalRecordAttachment[];
  metadata: Record<string, string>;
}

export interface MedicalRecordInput {
  patientId: string;
  doctorId: string;
  kind: MedicalRecordKind;
  title: string;
  description?: string;
  category?: string;
  severity?: MedicalRecordSeverity;
  startDate?: string;
  endDate?: string;
  metadata?: Record<string, string>;
  consultationId?: string;
}
