// Identité visuelle VisioDoc (source : jarvis/context/visiodoc/brand/, d'après visiodoc.jpeg du designer).
export const BRAND_COLORS = {
  gradientStart: '#0E8470',
  gradientMid: '#1AA68A',
  gradientEnd: '#3BB896',
  /** Couleur dominante du dégradé (fond de l'icône adaptative Android et du splash). */
  dominant: '#1AA68A',
  glyph: '#F4FAF8',
  camera: '#2C9E88',
  glyphOnLight: '#0F8A74',
  tileLight: '#FFFFFF',
  wordmarkOnLight: '#0F6E5E',
  wordmarkOnDark: '#FFFFFF',
};

// POINT UNIQUE pour la police du mot « VisioDoc » : Poppins Bold (assets/fonts/Poppins-Bold.ttf,
// licence OFL), chargée dans app/_layout.tsx sous ce nom. `null` pour revenir au repli (Fraunces bold).
export const BRAND_WORDMARK_FONT_PREFERRED: string | null = 'Poppins-Bold';
export const BRAND_WORDMARK_FONT: string = BRAND_WORDMARK_FONT_PREFERRED ?? 'Fraunces_700Bold';
