import { supabase, supabaseConfigured } from '@/lib/supabase';
import { translate } from '@/i18n/core';
import { isGender, type Gender } from '@/services/registration';
import { countryUsesPostnom } from '@/config/countries';
import { identityNamesIssue } from '@/utils/identityNames';
import { birthDateIssue, birthDateMessage, normalizePlace } from '@/utils/birthDate';
import type { User } from '@/types';

/** Pays du parcours téléphone (la ligne `patients` est écrite avec `RDC`). */
export const PHONE_IDENTITY_COUNTRY_CODE = 'CD';

/**
 * Complétion d'identité d'un patient inscrit par téléphone (MOB-1211-1, §2) : même règle que
 * l'inscription par e-mail, date de naissance obligatoire (18 ans révolus), ville obligatoire,
 * commune facultative. Le genre saisi ici est écrit UNE fois et repris dans `users` ET `patients`.
 */
export interface PhoneIdentityInput {
  firstName: string;
  lastName: string;
  /** Post-nom (`users.post_nom`), pays congolais ; vide = `null` en base. */
  postNom?: string;
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
  const names = identityNamesIssue(input, countryUsesPostnom(PHONE_IDENTITY_COUNTRY_CODE));
  if (names) return names;
  if (!isGender(input.gender)) return translate('Choisis ton genre : Masculin ou Féminin.');
  const dob = birthDateIssue(input.dateOfBirth, today);
  if (dob) return birthDateMessage(dob);
  const city = normalizePlace(input.city);
  if (city === null) return translate('La ville ne doit pas dépasser 100 caractères.');
  if (!city) return translate('La ville est obligatoire.');
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

  const { data: updatedUsers, error: userError } = await supabase
    .from('users')
    .update({
      first_name: input.firstName.trim(),
      last_name: input.lastName.trim(),
      post_nom: input.postNom?.trim() || null,
      gender: input.gender,
      identity_completed_at: new Date().toISOString(),
    })
    .eq('id', userId)
    .select('id');
  if (userError) throw userError;
  // Un update qui ne touche aucune ligne ne renvoie pas d'erreur : ne jamais conclure à un succès silencieux.
  if (!updatedUsers || updatedUsers.length === 0) {
    throw new Error(translate("Ton profil n'a pas pu être enregistré. Réessaie dans un instant."));
  }

  const { error: patientError } = await supabase
    .from('patients')
    .upsert(buildPatientsRow(userId, input), { onConflict: 'user_id' });
  if (patientError) {
    // MOB-1711-3 : la base refuse un patient mineur (trigger, code 23514, message PATIENT_MUST_BE_ADULT).
    if (/PATIENT_MUST_BE_ADULT/.test(`${patientError.message ?? ''} ${patientError.details ?? ''}`)) {
      throw new Error(translate('Vous devez avoir au moins 18 ans révolus pour vous inscrire.'));
    }
    throw patientError;
  }

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
