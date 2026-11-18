import { AFRICAN_COUNTRIES } from '@/config/africanCountries';
import { filterByPrefix } from '@/services/geo';

jest.mock('@/lib/supabase', () => ({ supabasePublic: null, supabase: null }));

describe('filtre des pays (CountryPicker)', () => {
  const names = (q: string) => filterByPrefix(AFRICAN_COUNTRIES, q, AFRICAN_COUNTRIES.length).map((c) => c.name);

  it('propose les pays dont le nom commence par la saisie, sans casse ni accents', () => {
    expect(names('alg')).toEqual(['Algérie']);
    expect(names('ALGE')).toEqual(['Algérie']);
    expect(names('gerie')).toEqual([]);
    expect(names('').length).toBe(AFRICAN_COUNTRIES.length);
  });
});
