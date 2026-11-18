import { supabase, supabasePublic } from '@/lib/supabase';
import { DEFAULT_RDC_CITIES } from '@/data/drcCities';

/** Nombre de propositions affichées sous un champ. */
export const SUGGESTION_LIMIT = 6;
/** Délai d'anti-rebond de la saisie (ms). */
export const GEO_DEBOUNCE_MS = 250;

const FETCH_CITIES_LIMIT = 500;
const FETCH_COMMUNES_LIMIT = 300;
const DEFAULT_COUNTRY = 'CD';

export type CityItem = { id: string; name: string };
export type CommuneItem = { id: string; name: string };

/** Minuscule, sans accents, sans espaces superflus : base de comparaison des filtres. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Éléments dont le nom COMMENCE par la saisie (casse et accents ignorés) ; tous si la saisie est vide. */
export function filterByPrefix<T extends { name: string }>(
  items: T[],
  query: string,
  limit: number = SUGGESTION_LIMIT,
): T[] {
  const q = normalizeText(query);
  const out = q ? items.filter((i) => normalizeText(i.name).startsWith(q)) : items;
  return out.slice(0, limit);
}

// Cache mémoire simple (durée de vie de l'application).
const cityCache = new Map<string, CityItem[]>();
const communeCache = new Map<string, CommuneItem[]>();

export function resetGeoCache(): void {
  cityCache.clear();
  communeCache.clear();
}

function staticCities(countryCode: string): CityItem[] {
  if (countryCode !== DEFAULT_COUNTRY) return [];
  return DEFAULT_RDC_CITIES.map((c, i) => ({ id: `static-city-${i}`, name: c.name }));
}

function staticCommunes(cityId: string): CommuneItem[] {
  const m = /^static-city-(\d+)$/.exec(cityId);
  const city = m ? DEFAULT_RDC_CITIES[Number(m[1])] : undefined;
  return (city?.communes ?? []).map((name, i) => ({ id: `static-com-${cityId}-${i}`, name }));
}

/** Villes actives d'un pays (lecture anon, cache) ; repli statique RDC si vide ou en erreur. */
export async function loadCities(countryCode: string = DEFAULT_COUNTRY): Promise<CityItem[]> {
  const cached = cityCache.get(countryCode);
  if (cached) return cached;
  try {
    if (supabasePublic) {
      const { data, error } = await supabasePublic
        .from('cities')
        .select('id, name, normalized_name, country_code')
        .eq('is_active', true)
        .eq('country_code', countryCode)
        .order('name', { ascending: true })
        .limit(FETCH_CITIES_LIMIT);
      if (!error && data && data.length > 0) {
        const list = (data as { id: string; name: string }[]).map((r) => ({ id: r.id, name: r.name }));
        cityCache.set(countryCode, list);
        return list;
      }
    }
  } catch {
    // repli statique
  }
  return staticCities(countryCode);
}

/** Propositions de villes dont le nom commence par la saisie. Ne lève jamais d'erreur. */
export async function searchCities(query: string, countryCode: string = DEFAULT_COUNTRY): Promise<CityItem[]> {
  return filterByPrefix(await loadCities(countryCode), query);
}

/** Communes actives d'une ville connue (par id), cache, repli statique. */
async function loadCommunes(city: CityItem): Promise<CommuneItem[]> {
  const cached = communeCache.get(city.id);
  if (cached) return cached;
  if (city.id.startsWith('static-city-')) return staticCommunes(city.id);
  try {
    if (supabasePublic) {
      const { data, error } = await supabasePublic
        .from('communes')
        .select('id, city_id, name, normalized_name')
        .eq('is_active', true)
        .eq('city_id', city.id)
        .order('name', { ascending: true })
        .limit(FETCH_COMMUNES_LIMIT);
      if (!error && data && data.length > 0) {
        const list = (data as { id: string; name: string }[]).map((r) => ({ id: r.id, name: r.name }));
        communeCache.set(city.id, list);
        return list;
      }
    }
  } catch {
    // repli statique
  }
  return [];
}

/**
 * Propositions de communes de la ville saisie (liées par `city_id`), dont le nom commence par `query`.
 * Ville vide ou inconnue : aucune proposition (la saisie libre reste possible).
 */
export async function searchCommunes(
  cityName: string,
  query: string,
  countryCode: string = DEFAULT_COUNTRY,
): Promise<CommuneItem[]> {
  const name = normalizeText(cityName);
  if (!name) return [];
  const cities = await loadCities(countryCode);
  let city = cities.find((c) => normalizeText(c.name) === name);
  if (!city) {
    // Base vide pour ce pays mais ville connue de la référence statique.
    const st = staticCities(countryCode).find((c) => normalizeText(c.name) === name);
    if (!st) return [];
    city = st;
  }
  let communes = await loadCommunes(city);
  if (communes.length === 0 && !city.id.startsWith('static-city-')) {
    const st = staticCities(countryCode).find((c) => normalizeText(c.name) === name);
    if (st) communes = staticCommunes(st.id);
  }
  return filterByPrefix(communes, query);
}

/**
 * Enregistre une saisie libre inconnue via les RPC serveur (réservées aux utilisateurs connectés,
 * comme sur le web). Au mieux : n'échoue jamais, ne bloque jamais l'écran.
 */
export async function recordPlaceIfNew(
  city: string,
  commune: string,
  countryCode: string = DEFAULT_COUNTRY,
): Promise<void> {
  const c = city.trim();
  if (!c || !supabase) return;
  try {
    const known = (await loadCities(countryCode)).some((x) => normalizeText(x.name) === normalizeText(c));
    let cityId: string | null = null;
    if (!known) {
      const { data, error } = await supabase.rpc('record_city_if_not_exists', {
        p_name: c,
        p_country_code: countryCode,
      });
      if (error || !data) return;
      cityId = data as string;
      cityCache.delete(countryCode);
    } else {
      cityId = (await loadCities(countryCode)).find((x) => normalizeText(x.name) === normalizeText(c))!.id;
    }
    const com = commune.trim();
    if (!com || cityId.startsWith('static-city-')) return;
    const knownCom = (communeCache.get(cityId) ?? []).some((x) => normalizeText(x.name) === normalizeText(com));
    if (knownCom) return;
    await supabase.rpc('record_commune_if_not_exists', { p_city_id: cityId, p_name: com });
    communeCache.delete(cityId);
  } catch {
    // saisie libre conservée côté appelant
  }
}
