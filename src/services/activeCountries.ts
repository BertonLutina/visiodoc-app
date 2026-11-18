import { supabasePublic } from '@/lib/supabase';
import { AFRICAN_COUNTRIES, type AfricanCountry } from '@/config/africanCountries';

/** Repli (lecture impossible, colonne absente, backend non configuré) : uniquement la RDC, jamais toute l'Afrique. */
export const FALLBACK_COUNTRY_CODE = 'CD';

let cache: string[] | null = null;
let inflight: Promise<string[]> | null = null;

/** Intersection : pays en base ∩ pays connus de l'app (drapeau, indicatif). */
export function knownActiveCountries(activeCodes: string[]): AfricanCountry[] {
  const set = new Set(activeCodes.map((c) => c.toUpperCase()));
  return AFRICAN_COUNTRIES.filter((c) => set.has(c.code));
}

/** Pays proposables pour le Visiodoc du compte : codes ouverts aux inscriptions ∩ connus de l'app. */
export function openSignupCountries(openCodes: readonly string[]): AfricanCountry[] {
  return knownActiveCountries([...openCodes]);
}

export function fallbackCountries(): AfricanCountry[] {
  return AFRICAN_COUNTRIES.filter((c) => c.code === FALLBACK_COUNTRY_CODE);
}

/**
 * Codes ISO des pays `is_active = true` ET `signup_open = true` (lecture anon, cache mémoire).
 * Rétrocompatibilité : tant que la colonne `countries.signup_open` n'est pas appliquée, la requête échoue
 * (colonne inconnue) : repli sur la RDC seule, jamais sur tous les pays actifs. Un repli n'est pas mis en cache.
 */
export async function fetchSignupOpenCountryCodes(): Promise<string[]> {
  if (cache) return cache;
  if (!supabasePublic) return [FALLBACK_COUNTRY_CODE];
  if (!inflight) {
    inflight = (async () => {
      try {
        const { data, error } = await supabasePublic!
          .from('countries')
          .select('code, signup_open')
          .eq('is_active', true)
          .eq('signup_open', true)
          .order('name', { ascending: true });
        if (error || !data) return [FALLBACK_COUNTRY_CODE];
        const codes = (data as { code: string }[]).map((r) => r.code);
        cache = codes;
        return codes;
      } catch {
        return [FALLBACK_COUNTRY_CODE];
      } finally {
        inflight = null;
      }
    })();
  }
  return inflight;
}

/** Pays proposables (Visiodoc du compte) : ouverts aux inscriptions ∩ connus ; repli RDC si vide ou en erreur. */
export async function getActiveCountries(): Promise<AfricanCountry[]> {
  const list = openSignupCountries(await fetchSignupOpenCountryCodes());
  return list.length > 0 ? list : fallbackCountries();
}

export function resetActiveCountriesCache(): void {
  cache = null;
  inflight = null;
}
