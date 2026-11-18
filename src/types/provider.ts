// Types côté médecin (provider) — alignés sur le backend Supabase de l'app web.
import type { ConsultationStatus, ConsultationType } from '@/types';
import type { Gender } from '@/services/registration';
import type { ProviderEarnings } from '@/services/dashboardMetrics';
import type { ConsultationChildInfo } from '@/types/children';

export interface ProviderProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  specialization: string;
  licenseNumber: string;
  city: string;
  yearsOfExperience: number;
  consultationFee: number;
  rating: number;
  totalConsultations: number;
  validationStatus: 'PENDING_VALIDATION' | 'VALIDATED' | 'REJECTED' | 'SUSPENDED';
  subscriptionActive: boolean;
  initials: string;
}

export interface ProviderStats {
  patientsTotal: number;
  patientsNew: number;
  consultationsThisMonth: number;
  consultationsTrend: string; // ex: "+12% vs mois préc."
  netRevenue: number;
  averageRating: number;
}

export interface ProviderPatient {
  /** Clé unique de la ligne : l'id de l'enfant pour un enfant, sinon l'id du patient. */
  id: string;
  /** Compte patient (le parent pour un enfant). Absent = `id`. */
  patientId?: string;
  /** Renseigné pour une ligne d'enfant : une ligne par enfant, jamais mélangée avec celle du parent. */
  childId?: string | null;
  /** Nom du parent, pour une ligne d'enfant. */
  parentName?: string;
  firstName: string;
  lastName: string;
  /** `null` quand `users.date_of_birth` est absente — jamais un 0 trompeur. */
  age: number | null;
  /** `null` quand `users.gender` est absent ou différent de `male` / `female` (ex. ancien `other`). */
  gender: Gender | null;
  mainCondition: string;
  initials: string;
}

export interface PatientDetail {
  id: string;
  firstName: string;
  lastName: string;
  initials: string;
  age: number | null;
  gender: Gender | null;
  bloodType: string | null;
  allergiesSummary: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
}

export interface ProviderConsultation {
  id: string;
  patient: { id: string; firstName: string; lastName: string; initials: string };
  /** Consultation d'un enfant (`consultations.child_id`) : le patient soigné est l'enfant, `patient` est le parent. */
  child?: ConsultationChildInfo;
  reason: string;
  dateLabel: string;
  type: ConsultationType;
  durationMin: number;
  status: ConsultationStatus;
  /** Statut brut de la table `consultations` (ex: `no_show`, absent du vocabulaire affiché). */
  rawStatus?: string;
  /** ISO de `scheduled_at`, pour les comptes à rebours. */
  scheduledAt?: string;
  roomId?: string;
}

export interface AvailabilitySlot {
  id: string;
  dayOfWeek: number; // 0=Lun ... 6=Dim
  startTime: string; // "09:00"
  endTime: string;
  slotDuration: number; // min
  count: number; // nb créneaux
  /** Période inclusive pendant laquelle la règle hebdomadaire est proposée aux patients. */
  validFrom?: string | null;
  validTo?: string | null;
}

export interface AvailabilityException {
  id: string;
  label: string; // ex: "Congé"
  dateLabel: string; // ex: "25 – 28 juin 2026"
}

export interface SubscriptionPlan {
  id: 'monthly' | 'annual';
  name: string;
  price: number; // en devise locale (FC en RDC)
  period: string; // "/ mois" | "/ an"
  hint?: string; // ex: "Économisez 24%"
  features: string[];
  recommended?: boolean;
}

export interface ProviderReview {
  id: string;
  author: string;
  rating: number;
  comment: string;
  date: string;
}

export interface DashboardAlert {
  id: string;
  tone: 'info' | 'warning' | 'danger';
  message: string;
  href: string;
}

export interface DashboardOverview {
  patientsTotal: number;
  patientsNew: number;
  consultationsThisMonth: number;
  consultationsTrend: string;
  /** Revenu payé du mois dans `revenueCurrency` (montant stocké, sans commission côté client). */
  netRevenue: number;
  /** Devise de `netRevenue` / `revenueSeries` ; `null` sans revenu ou sans code devise. */
  revenueCurrency: string | null;
  revenueSeries: { label: string; amount: number }[];
  /** En cours (consultations payées non versées) et versés (`provider_payouts` payés), par devise. */
  earnings: ProviderEarnings;
  /** `true` quand la lecture des revenus a échoué : afficher « indisponibles », jamais « aucun revenu ». */
  earningsError: boolean;
  /** % sur les 90 derniers jours, `null` s'il n'y a aucun rendez-vous passé. */
  cancellationRate: number | null;
  noShowRate: number | null;
  weekAgenda: { date: string; label: string; dayNumber: number; count: number; isToday: boolean }[];
  weekBooked: number;
  weekCapacity: number;
  /** `null` quand aucune disponibilité n'est configurée. */
  fillRate: number | null;
  patientsToRecall: number;
  pendingPayment: number;
  next: ProviderConsultation | null;
}

export interface ReviewSummary {
  average: number | null;
  count: number;
  /** Nombre d'avis par note, index 0 = 1 étoile … index 4 = 5 étoiles. */
  distribution: number[];
  recent: ProviderReview[];
}
