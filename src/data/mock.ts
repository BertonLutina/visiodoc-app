import type {
  Consultation,
  Doctor,
  MedicalRecord,
  TimeSlot,
  User,
  Wallet,
} from '@/types';
import { activeCountry } from '@/config/countries';

export const currentPatient: User = {
  id: 'patient-1',
  email: 'marie.konate@gmail.com',
  firstName: 'Marie',
  lastName: 'Konaté',
  role: 'patient',
  phone: '+243 81 000 0000',
  countryCode: 'CD',
};

export const doctors: Doctor[] = [
  {
    id: 'doc-1',
    firstName: 'Amara',
    lastName: 'Diallo',
    specialty: 'Médecine générale',
    city: 'Kinshasa',
    fee: 15000,
    rating: 4.9,
    reviewsCount: 127,
    yearsOfExperience: 8,
    patientsCount: 240,
    availabilityLabel: 'Dispo auj.',
    initials: 'AD',
  },
  {
    id: 'doc-2',
    firstName: 'Ngozi',
    lastName: 'Kamau',
    specialty: 'Pédiatrie',
    city: 'Lubumbashi',
    fee: 20000,
    rating: 4.8,
    reviewsCount: 94,
    yearsOfExperience: 11,
    patientsCount: 310,
    availabilityLabel: 'Dispo auj.',
    initials: 'NK',
  },
  {
    id: 'doc-3',
    firstName: 'Oumarou',
    lastName: 'Traoré',
    specialty: 'Cardiologie',
    city: 'Goma',
    fee: 35000,
    rating: 4.7,
    reviewsCount: 61,
    yearsOfExperience: 15,
    patientsCount: 180,
    availabilityLabel: 'Demain dispo',
    initials: 'OT',
  },
  {
    id: 'doc-4',
    firstName: 'Fatou',
    lastName: 'Ndiaye',
    specialty: 'Gynécologie',
    city: 'Kinshasa',
    fee: 25000,
    rating: 4.9,
    reviewsCount: 88,
    yearsOfExperience: 10,
    patientsCount: 205,
    availabilityLabel: 'Dispo auj.',
    initials: 'FN',
  },
];

export const slots: TimeSlot[] = [
  { id: 's1', label: '09h00', available: true },
  { id: 's2', label: '11h30', available: true },
  { id: 's3', label: '14h00', available: true },
  { id: 's4', label: '15h30', available: true },
];

export const consultations: Consultation[] = [
  {
    id: 'c-1',
    doctor: { id: 'doc-1', firstName: 'Amara', lastName: 'Diallo', specialty: 'Médecine générale', initials: 'AD' },
    date: '2026-06-20T14:30:00',
    dateLabel: 'Jeu 20 juin · 14h30',
    type: 'video',
    durationMin: 30,
    fee: 15000,
    status: 'confirmed',
    roomId: 'visiodoc-c1',
  },
  {
    id: 'c-2',
    doctor: { id: 'doc-2', firstName: 'Ngozi', lastName: 'Kamau', specialty: 'Pédiatrie', initials: 'NK' },
    date: '2026-06-22T10:00:00',
    dateLabel: 'Sam 22 juin · 10h00',
    type: 'phone',
    durationMin: 20,
    fee: 20000,
    status: 'pending',
  },
  {
    id: 'c-3',
    doctor: { id: 'doc-3', firstName: 'Oumarou', lastName: 'Traoré', specialty: 'Cardiologie', initials: 'OT' },
    date: '2026-06-24T09:00:00',
    dateLabel: 'Lun 24 juin · 09h00',
    type: 'video',
    durationMin: 30,
    fee: 35000,
    status: 'confirmed',
  },
];

export const pastConsultations: Consultation[] = [
  {
    id: 'p-1',
    doctor: { id: 'doc-1', firstName: 'Amara', lastName: 'Diallo', specialty: 'Médecine générale', initials: 'AD' },
    date: '2026-06-10T10:00:00',
    dateLabel: '10 juin · 10h00',
    type: 'video',
    durationMin: 30,
    fee: 15000,
    status: 'completed',
  },
  {
    id: 'p-2',
    doctor: { id: 'doc-2', firstName: 'Ngozi', lastName: 'Kamau', specialty: 'Pédiatrie', initials: 'NK' },
    date: '2026-06-05T16:00:00',
    dateLabel: '5 juin · Téléphone',
    type: 'phone',
    durationMin: 20,
    fee: 20000,
    status: 'completed',
  },
];

export const wallet: Wallet = {
  balance: 47500,
  currency: activeCountry.currency.symbol,
  countryLabel: activeCountry.name,
  aiCreditsLeft: 8,
  transactions: [
    { id: 't1', label: 'Recharge M-Pesa', date: '15 juin 2026', amount: 25000, method: 'M-Pesa' },
    { id: 't2', label: 'Consult. Dr. Diallo', date: '10 juin 2026', amount: -15000 },
    { id: 't3', label: 'Recharge Airtel Money', date: '2 juin 2026', amount: 50000, method: 'Airtel Money' },
  ],
};

export const medicalRecords: MedicalRecord[] = [
  { id: 'r1', kind: 'ordonnance', title: 'Paracétamol 1g — 3x/jour · 7 jours', detail: 'Ordonnance', author: 'Dr. Amara Diallo', date: '10 juin 2026' },
  { id: 'r2', kind: 'diagnostic', title: 'Rhinopharyngite aiguë', detail: 'Diagnostic', author: 'Dr. Amara Diallo', date: '10 juin 2026' },
  { id: 'r3', kind: 'analyse', title: 'NFS complète — résultats normaux', detail: 'Analyse', author: 'Labo Pasteur', date: '5 mai 2026' },
  { id: 'r4', kind: 'vaccin', title: 'Fièvre jaune — à jour', detail: 'Vaccin', author: 'HGR Kinshasa', date: '12 jan. 2026' },
  { id: 'r5', kind: 'allergie', title: 'Allergie connue : Pénicilline', detail: 'Allergie', author: 'Dr. Ndiaye', date: '3 mars 2025' },
];
