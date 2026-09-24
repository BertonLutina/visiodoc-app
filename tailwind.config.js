/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Vert émeraude VisioDoc — couleur de marque (logo + mockup)
        primary: {
          DEFAULT: '#0F6E56',
          50: '#E1F5EE',
          100: '#C2E8DA',
          200: '#9FE1CB',
          400: '#2E9B79',
          500: '#15846A',
          600: '#0F6E56',
          700: '#0B5544',
          900: '#063A2E',
        },
        // Orange VisioDoc — accent / rôle médecin prestataire
        accent: {
          DEFAULT: '#EA580C',
          50: '#FFF7ED',
          600: '#EA580C',
          700: '#9A3412',
        },
        soft: '#2E9B79', // vert moyen — actions secondaires
        mint: '#9FE1CB', // menthe — fonds doux
        clay: '#9A3412', // accent terre/orange foncé — méta, dates
        ink: '#111111',
        muted: '#6B7280',
        line: '#E5E7EB',
        bg: '#F8FAFB',
        surface: '#FFFFFF',
        success: '#15846A',
        danger: '#DC2626',
        star: '#E0A53B',
        // teintes douces des vignettes
        peach: '#FFF7ED',
        lavender: '#E6F1FB',
        sage: '#E1F5EE',
        sand: '#EAF3DE',
      },
      fontFamily: {
        // Sans Bloom — UI, corps de texte
        sans: ['Mulish_400Regular'],
        'sans-medium': ['Mulish_500Medium'],
        'sans-semibold': ['Mulish_600SemiBold'],
        'sans-bold': ['Mulish_700Bold'],
        'sans-extrabold': ['Mulish_800ExtraBold'],
        // Serif Bloom — titres éditoriaux
        serif: ['Fraunces_500Medium'],
        'serif-semibold': ['Fraunces_600SemiBold'],
        'serif-bold': ['Fraunces_700Bold'],
      },
    },
  },
  plugins: [],
};
