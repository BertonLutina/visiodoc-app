import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { getDeviceId } from '@/services/deviceId';

export type AuthEventMethod =
  | 'password'
  | 'email_otp'
  | 'phone_otp'
  | 'oauth_google'
  | 'oauth_azure'
  | 'registration'
  | 'biometric';

/**
 * Journalise une connexion/déconnexion dans `audit_logs` (table déjà utilisée par le
 * backoffice admin pour d'autres actions). Best-effort : ne doit jamais faire échouer
 * ou ralentir un flux d'auth si l'insert échoue (hors-ligne, RLS, etc.).
 */
export async function logAuthEvent(
  action: 'auth:login' | 'auth:logout' | 'auth:biometric_unlock' | 'auth:biometric_enroll',
  user: { id: string; role: string; countryId?: string | null },
  method?: AuthEventMethod,
): Promise<void> {
  if (!supabase) return;
  try {
    const deviceId = await getDeviceId();
    await supabase.from('audit_logs').insert({
      actor_id: user.id,
      actor_role: user.role,
      country_id: user.countryId ?? null,
      action,
      target_id: user.id,
      payload: { device_id: deviceId, method: method ?? null, platform: Platform.OS },
    });
  } catch {
    /* best-effort : ne jamais bloquer l'auth pour un souci de journalisation */
  }
}
