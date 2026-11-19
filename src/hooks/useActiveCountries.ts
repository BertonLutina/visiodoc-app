import { useEffect, useState } from 'react';
import type { AfricanCountry } from '@/config/africanCountries';
import { fallbackCountries, getActiveCountries } from '@/services/activeCountries';

/** Liste des pays proposables (RDC seule tant que la lecture n'a pas abouti). */
export function useActiveCountries(): AfricanCountry[] {
  const [countries, setCountries] = useState<AfricanCountry[]>(fallbackCountries);
  useEffect(() => {
    let active = true;
    getActiveCountries().then((list) => active && setCountries(list));
    return () => {
      active = false;
    };
  }, []);
  return countries;
}
