import type {
  AvailabilityException,
  AvailabilitySlot,
  ProviderConsultation,
  ProviderPatient,
  ProviderProfile,
  ProviderReview,
  ProviderStats,
  SubscriptionPlan,
  DashboardOverview,
  ReviewSummary,
} from '@/types/provider';

export const currentProvider: ProviderProfile = {
  id: 'doc-1',
  firstName: 'Amara',
  lastName: 'Diallo',
  email: 'a.diallo@clinic.cd',
  phone: '+243 81 111 2222',
  specialization: 'Médecine générale',
  licenseNumber: 'CD-MG-2019-0042',
  city: 'Kinshasa',
  yearsOfExperience: 8,
  consultationFee: 15000,
  rating: 4.9,
  totalConsultations: 240,
  validationStatus: 'VALIDATED',
  subscriptionActive: true,
  initials: 'AD',
};

export const providerStats: ProviderStats = {
  patientsTotal: 124,
  patientsNew: 8,
  consultationsThisMonth: 38,
  consultationsTrend: '+12% vs mois préc.',
  netRevenue: 450000,
  averageRating: 4.9,
};

export const providerTodayConsultations: ProviderConsultation[] = [
  {
    id: 'pc-1',
    patient: { id: 'pat-1', firstName: 'Marie', lastName: 'Konaté', initials: 'MK' },
    reason: 'Méd. générale',
    dateLabel: '14h30',
    type: 'video',
    durationMin: 30,
    status: 'confirmed',
    roomId: 'visiodoc-c1',
  },
  {
    id: 'pc-2',
    patient: { id: 'pat-2', firstName: 'Bamba', lastName: 'Sow', initials: 'BS' },
    reason: 'Hypertension',
    dateLabel: '16h00',
    type: 'phone',
    durationMin: 20,
    status: 'confirmed',
  },
];

export const providerUpcomingConsultations: ProviderConsultation[] = [
  ...providerTodayConsultations,
  {
    id: 'pc-3',
    patient: { id: 'pat-3', firstName: 'Aïcha', lastName: 'Ndiaye', initials: 'AN' },
    reason: 'Suivi prénatal',
    dateLabel: 'Demain · 09h00',
    type: 'video',
    durationMin: 30,
    status: 'pending',
  },
];

export const providerPatients: ProviderPatient[] = [
  { id: 'pat-1', firstName: 'Marie', lastName: 'Konaté', age: 38, gender: 'female', mainCondition: 'Rhinopharyngite', initials: 'MK' },
  { id: 'pat-2', firstName: 'Bamba', lastName: 'Sow', age: 45, gender: 'male', mainCondition: 'Hypertension artérielle', initials: 'BS' },
  { id: 'pat-3', firstName: 'Aïcha', lastName: 'Ndiaye', age: 29, gender: 'female', mainCondition: 'Suivi prénatal', initials: 'AN' },
  { id: 'pat-4', firstName: 'Oumar', lastName: 'Camara', age: 52, gender: 'male', mainCondition: 'Diabète type 2', initials: 'OC' },
];

export const providerAvailability: AvailabilitySlot[] = [
  { id: 'a1', dayOfWeek: 0, startTime: '09:00', endTime: '12:00', slotDuration: 30, count: 6 },
  { id: 'a2', dayOfWeek: 0, startTime: '14:00', endTime: '17:00', slotDuration: 30, count: 6 },
  { id: 'a3', dayOfWeek: 1, startTime: '09:00', endTime: '13:00', slotDuration: 30, count: 8 },
  { id: 'a4', dayOfWeek: 2, startTime: '14:00', endTime: '18:00', slotDuration: 45, count: 5 },
];

export const providerExceptions: AvailabilityException[] = [
  { id: 'e1', label: '🏖 Exception · Congé', dateLabel: '25 – 28 juin 2026 · Repos' },
];

export const feeConfig = {
  currentFee: 15000,
  platformFeeRate: 0.04, // 4%
};

export const subscriptionPlans: SubscriptionPlan[] = [
  {
    id: 'annual',
    name: 'Plan Annuel',
    price: 89900,
    period: '/ an',
    hint: 'Économisez 24%',
    recommended: true,
    features: [
      'Consultations vidéo illimitées',
      'Consultations audio illimitées',
      'Gestion patients & dossiers',
      'Gestion des disponibilités',
      'Accès sécurisé à la plateforme',
    ],
  },
  {
    id: 'monthly',
    name: 'Plan Mensuel',
    price: 9900,
    period: '/ mois',
    features: ['Mêmes fonctionnalités'],
  },
];

export const providerReviews: ProviderReview[] = [
  { id: 'rv1', author: 'Marie K.', rating: 5, comment: 'Très professionnel et à l\'écoute.', date: '10 juin 2026' },
];

export const dashboardOverview: DashboardOverview = {
  patientsTotal: 124,
  patientsNew: 8,
  consultationsThisMonth: 38,
  consultationsTrend: '+12% vs mois préc.',
  netRevenue: 450000,
  revenueCurrency: 'CDF',
  earningsError: false,
  earnings: { inProgress: [{ currency: 'CDF', amount: 450000 }], paid: [{ currency: 'CDF', amount: 1200000 }] },
  revenueSeries: [
    { label: 'mai', amount: 280000 },
    { label: 'juin', amount: 310000 },
    { label: 'juil.', amount: 350000 },
    { label: 'août', amount: 330000 },
    { label: 'sept.', amount: 410000 },
    { label: 'oct.', amount: 450000 },
  ],
  cancellationRate: 12,
  noShowRate: 5,
  weekAgenda: ['Mer', 'Jeu', 'Ven', 'Sam', 'Dim', 'Lun', 'Mar'].map((label, i) => ({
    date: `2026-10-${14 + i}`,
    label,
    dayNumber: 14 + i,
    count: [3, 2, 4, 0, 0, 3, 1][i],
    isToday: i === 0,
  })),
  weekBooked: 13,
  weekCapacity: 20,
  fillRate: 65,
  patientsToRecall: 3,
  pendingPayment: 1,
  next: providerTodayConsultations[0] ?? null,
};

export const reviewSummary: ReviewSummary = {
  average: 4.9,
  count: 1,
  distribution: [0, 0, 0, 0, 1],
  recent: providerReviews,
};
