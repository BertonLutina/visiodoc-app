import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { appEnv } from '@/config/appEnv';
import { configurationProblem } from '@/config/configurationProblem';
import { secureSessionStorage } from './secureSessionStorage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Build `uat` / `production` sans URL ou sans clé : `null` en développement local (`__DEV__`, Jest),
 * où les données mock restent permises. Affiché en écran bloquant par `app/_layout.tsx`.
 */
export const supabaseConfigurationProblem: string | null =
  typeof __DEV__ !== 'undefined' && __DEV__
    ? null
    : configurationProblem({ url: supabaseUrl, anonKey: supabaseAnonKey, appEnv: appEnv() });

if (supabaseConfigurationProblem && !process.env.JEST_WORKER_ID) {
  console.error(supabaseConfigurationProblem);
}

// En Phase 1 (frontend seul) le client peut être absent : les écrans utilisent
// les données mock. Le lien réel sera activé en Phase 2.
export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = supabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string, {
      auth: {
        // Jetons de session dans le trousseau (expo-secure-store) ; AsyncStorage reste réservé à la
        // langue, aux notifications et aux brouillons non secrets.
        storage: secureSessionStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

/**
 * Client PUBLIC (rôle anon, sans session) pour les lectures du catalogue
 * accessibles à tous : liste des médecins, fiche médecin.
 * Nécessaire car, une fois le patient connecté, la RLS de `users` ne laisse
 * lire que sa propre ligne — le rôle anon, lui, voit les médecins actifs.
 */
export const supabasePublic = supabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  : null;
