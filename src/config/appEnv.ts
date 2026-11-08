export type AppEnv = 'development' | 'uat' | 'production';

/** Valeur absente ou inconnue => `production` : une variable manquante n'active jamais un comportement de développement. */
export const parseAppEnv = (value: string | undefined): AppEnv =>
  value === 'development' || value === 'uat' ? value : 'production';

/** Environnement du build, posé par `eas.json` (`EXPO_PUBLIC_APP_ENV`). Référence statique : Expo ne l'injecte qu'ainsi. */
export const appEnv = (): AppEnv => parseAppEnv(process.env.EXPO_PUBLIC_APP_ENV);
