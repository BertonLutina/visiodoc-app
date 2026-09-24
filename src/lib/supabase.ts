import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// En Phase 1 (frontend seul) le client peut être absent : les écrans utilisent
// les données mock. Le lien réel sera activé en Phase 2.
export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = supabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string, {
      auth: {
        storage: AsyncStorage,
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
