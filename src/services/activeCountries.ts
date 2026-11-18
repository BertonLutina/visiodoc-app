import { supabasePublic } from '@/lib/supabase';
import { AFRICAN_COUNTRIES, type AfricanCountry } from '@/config/africanCountries';

/** Repli (lecture impossible, backend non configuré) : uniquement la RDC, jamais toute l'Afrique. */
export const FALLBACK_COUNTRY_CODE = 'CD';

let cache: string[] | null = null;
let inflight: Promise<string[]> | null = null;

/** Intersection : pays actifs en base ∩ pays connus de l'app (drapeau, indicatif). */
export function knownActiveCountries(activeCodes: string[]): AfricanCountry[] {
  const set = new Set(activeCodes.map((c) => c.toUpperCase()));
  return AFRICAN_COUNTRIES.filter((c) => set.has(c.code));
}

export function fallbackCountries(): AfricanCountry[] {
  return AFRICAN_COUNTRIES.filter((c) => c.code === FALLBACK_COUNTRY_CODE);
}

/** Codes ISO des pays `is_active = true` (lecture anon, mise en cache mémoire). */
export async function fetchActiveCountryCodes(): Promise<string[]> {
  if (cache) return cache;
  if (!supabasePublic) return [FALLBACK_COUNTRY_CODE];
  if (!inflight) {
    inflight = (async () => {
      try {
        const { data, error } = await supabasePublic!
          .from('countries')
          .select('code')
          .eq('is_active', true)
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

/** Pays proposables : actifs ∩ connus ; repli RDC si vide ou en erreur. */
export async function getActiveCountries(): Promise<AfricanCountry[]> {
  const list = knownActiveCountries(await fetchActiveCountryCodes());
  return list.length > 0 ? list : fallbackCountries();
}

export function resetActiveCountriesCache(): void {
  cache = null;
  inflight = null;
}
