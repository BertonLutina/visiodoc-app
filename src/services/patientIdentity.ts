import { supabase, supabaseConfigured } from '@/lib/supabase';
import { translate } from '@/i18n/core';
import { isGender, type Gender } from '@/services/registration';
import { birthDateIssue, birthDateMessage, normalizePlace } from '@/utils/birthDate';
import type { User } from '@/types';

/**
 * Complétion d'identité d'un patient inscrit par téléphone (MOB-1211-1, §2) : même règle que
 * l'inscription par e-mail, date de naissance obligatoire (18 ans révolus), ville et commune
 * facultatives. Le genre saisi ici est écrit UNE fois et repris dans `users` ET `patients`.
 */
export interface PhoneIdentityInput {
  firstName: string;
  lastName: string;
  gender: Gender | null;
  /** `AAAA-MM-JJ`. */
  dateOfBirth: string;
  city?: string;
  commune?: string;
}

/** Un patient connecté par code sans nom de famille n'a pas encore complété son identité. */
export function needsPhoneIdentity(user: Pick<User, 'role' | 'lastName'> | null | undefined): boolean {
  return !!user && user.role === 'patient' && !user.lastName.trim();
}

/** Message d'erreur du premier champ invalide, ou `null` ; vérifié AVANT tout appel réseau. */
export function phoneIdentityIssue(input: PhoneIdentityInput, today?: Date): string | null {
  if (!input.lastName.trim() || !input.firstName.trim()) return translate('Le nom et le prénom sont obligatoires.');
  if (!isGender(input.gender)) return translate('Choisis ton genre : Masculin ou Féminin.');
  const dob = birthDateIssue(input.dateOfBirth, today);
  if (dob) return birthDateMessage(dob);
  if (normalizePlace(input.city) === null) return translate('La ville ne doit pas dépasser 100 caractères.');
  if (normalizePlace(input.commune) === null) return translate('La commune ne doit pas dépasser 100 caractères.');
  return null;
}

/** Ligne `patients` (même forme que le web : upsert sur `user_id`, pays `RDC`). */
export function buildPatientsRow(userId: string, input: PhoneIdentityInput) {
  return {
    user_id: userId,
    date_of_birth: input.dateOfBirth.trim(),
    gender: input.gender,
    city: normalizePlace(input.city) ?? null,
    commune: normalizePlace(input.commune) ?? null,
    country: 'RDC',
  };
}

/** Enregistre l'identité du patient (nom, genre une seule fois, date de naissance, ville, commune). */
export async function completePhoneIdentity(userId: string, input: PhoneIdentityInput): Promise<void> {
  const issue = phoneIdentityIssue(input);
  if (issue) throw new Error(issue);
  if (!supabaseConfigured || !supabase) return;

  const { error: userError } = await supabase
    .from('users')
    .update({
      first_name: input.firstName.trim(),
      last_name: input.lastName.trim(),
      gender: input.gender,
      identity_completed_at: new Date().toISOString(),
    })
    .eq('id', userId);
  if (userError) throw userError;

  const { error: patientError } = await supabase
    .from('patients')
    .upsert(buildPatientsRow(userId, input), { onConflict: 'user_id' });
  if (patientError) throw patientError;

  await recordPlacesBestEffort(input);
}

/** Villes et communes inconnues : enregistrées par RPC, sans jamais bloquer l'inscription. */
async function recordPlacesBestEffort(input: PhoneIdentityInput): Promise<void> {
  const city = normalizePlace(input.city);
  if (!city || !supabase) return;
  try {
    const { data: cityId } = await supabase.rpc('record_city_if_not_exists', { p_name: city, p_country_code: 'CD' });
    const commune = normalizePlace(input.commune);
    if (cityId && commune) {
      await supabase.rpc('record_commune_if_not_exists', { p_city_id: cityId, p_name: commune });
    }
  } catch {
    /* suggestions seulement */
  }
}
