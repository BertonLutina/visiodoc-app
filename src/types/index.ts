// Types partagés VisioDoc Mobile — alignés sur le backend Supabase de l'app web.

export type UserRole = 'patient' | 'provider' | 'admin';

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
  avatarUrl?: string;
  countryCode?: string;
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
  fee: number; // en devise locale (FC en RDC)
  rating: number;
  reviewsCount: number;
  yearsOfExperience: number;
  patientsCount: number;
  availabilityLabel: string; // ex: "Dispo auj."
  initials: string;
}

export interface TimeSlot {
  id: string;
  label: string; // ex: "09h00"
  available: boolean;
}

export interface Consultation {
  id: string;
  doctor: Pick<Doctor, 'id' | 'firstName' | 'lastName' | 'specialty' | 'initials'>;
  date: string; // ISO ou libellé court
  dateLabel: string; // ex: "Jeu 20 juin · 14h30"
  type: ConsultationType;
  durationMin: number;
  fee: number;
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
