// Types côté médecin (provider) — alignés sur le backend Supabase de l'app web.
import type { ConsultationStatus, ConsultationType } from '@/types';

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
  id: string;
  firstName: string;
  lastName: string;
  age: number;
  gender: 'M' | 'F';
  mainCondition: string;
  initials: string;
}

export interface ProviderConsultation {
  id: string;
  patient: { id: string; firstName: string; lastName: string; initials: string };
  reason: string;
  dateLabel: string;
  type: ConsultationType;
  durationMin: number;
  status: ConsultationStatus;
  roomId?: string;
}

export interface PatientFile {
  patientId: string;
  firstName: string;
  lastName: string;
  initials: string;
  lastActLabel: string; // ex: "Ordonnance · 10 juin"
}

export interface AvailabilitySlot {
  id: string;
  dayOfWeek: number; // 0=Lun ... 6=Dim
  startTime: string; // "09:00"
  endTime: string;
  slotDuration: number; // min
  count: number; // nb créneaux
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
