import type { AppEnv } from './appEnv';

type ConfigurationEnv = { url?: string; anonKey?: string; appEnv: AppEnv };

const isMissing = (value: string | undefined): boolean => !value || value.trim() === '';

/**
 * Problème de configuration Supabase d'un build, ou `null`. Seuls les builds `uat` et `production`
 * sont concernés : ils ne doivent jamais retomber en silence sur les données mock (le mode `development`
 * garde ce confort). Le message nomme les variables manquantes, jamais leurs valeurs.
 */
export function configurationProblem({ url, anonKey, appEnv }: ConfigurationEnv): string | null {
  if (appEnv === 'development') return null;
  const missing: string[] = [];
  if (isMissing(url)) missing.push('EXPO_PUBLIC_SUPABASE_URL');
  if (isMissing(anonKey)) missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  if (missing.length === 0) return null;
  return `Configuration manquante : ${missing.join(' et ')} absente de ce build. Définissez-la dans les variables EAS avant de rebuilder.`;
}
