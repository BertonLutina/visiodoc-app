// Palette VisioDoc — marque (logo + mockup) sur grammaire Bloom (serif éditorial)
export const colors = {
  primary: '#0F6E56', // vert émeraude VisioDoc
  primaryDark: '#085041',
  primaryLight: '#E1F5EE',
  mint: '#9FE1CB',
  soft: '#2E9B79', // vert moyen — actions secondaires
  clay: '#9A3412', // accent terre/orange — méta / dates
  accent: '#EA580C', // orange — rôle médecin prestataire
  accentLight: '#FFF7ED',
  ink: '#111111',
  muted: '#6B7280',
  line: '#E5E7EB',
  bg: '#F8FAFB',
  white: '#FFFFFF',
  danger: '#DC2626',
  warning: '#D9A441',
  success: '#15846A',
  star: '#E0A53B',
  // teintes douces des vignettes
  peach: '#FFF7ED',
  lavender: '#E6F1FB',
  sage: '#E1F5EE',
  sand: '#EAF3DE',
};

// Familles de polices chargées dans _layout.tsx (pour les props style hors className)
export const fonts = {
  sans: 'Mulish_400Regular',
  sansMedium: 'Mulish_500Medium',
  sansSemibold: 'Mulish_600SemiBold',
  sansBold: 'Mulish_700Bold',
  sansExtrabold: 'Mulish_800ExtraBold',
  serif: 'Fraunces_500Medium',
  serifSemibold: 'Fraunces_600SemiBold',
  serifBold: 'Fraunces_700Bold',
};

export type AppColors = typeof colors;
