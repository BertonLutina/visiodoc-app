import { fonts } from './colors';

// Identité visuelle VisioDoc (source : jarvis/context/visiodoc/brand/).
export const BRAND_COLORS = {
  gradientStart: '#059669',
  gradientEnd: '#0D9488',
  wordmarkOnLight: '#111827',
  wordmarkOnDark: '#FFFFFF',
  tileLight: '#FFFFFF',
};

// POINT UNIQUE pour la police du mot « VisioDoc » : Poppins 700 n'est pas installée.
// Quand elle le sera (expo-font, p. ex. 'Poppins_700Bold'), remplacer uniquement
// BRAND_WORDMARK_FONT_PREFERRED ; le repli reprend la police de titre actuelle (Fraunces bold).
export const BRAND_WORDMARK_FONT_PREFERRED: string | null = null;
export const BRAND_WORDMARK_FONT: string = BRAND_WORDMARK_FONT_PREFERRED ?? fonts.serifBold;
