import { filterByPrefix, loadCities, normalizeText, recordPlaceIfNew, resetGeoCache, searchCities, searchCommunes } from './geo';

const mockResult = jest.fn();
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => {
  const chain = (): any => {
    const c: any = {};
    for (const k of ['select', 'eq', 'order']) c[k] = () => c;
    c.limit = () => mockResult();
    return c;
  };
  return {
    supabasePublic: { from: () => chain() },
    supabase: { rpc: (...a: unknown[]) => mockRpc(...a) },
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  resetGeoCache();
  mockRpc.mockResolvedValue({ data: 'new-id', error: null });
});

const rows = [
  { id: 'c1', name: 'Élisabethville' },
  { id: 'c2', name: 'Lubumbashi' },
  { id: 'c3', name: 'Likasi' },
];

describe('filterByPrefix', () => {
  it('matches the beginning only, ignoring case and accents', () => {
    expect(filterByPrefix(rows, 'eli').map((r) => r.id)).toEqual(['c1']);
    expect(filterByPrefix(rows, 'LI').map((r) => r.id)).toEqual(['c3']);
    expect(filterByPrefix(rows, 'bum')).toEqual([]);
  });
  it('limits the number of suggestions and returns all on empty query', () => {
    expect(filterByPrefix(rows, '', 2)).toHaveLength(2);
    expect(normalizeText('  Kisangani Éé ')).toBe('kisangani ee');
  });
});

describe('searchCities / searchCommunes', () => {
  it('reads cities once (cache) and filters by prefix', async () => {
    mockResult.mockResolvedValue({ data: rows, error: null });
    expect((await searchCities('lu')).map((c) => c.name)).toEqual(['Lubumbashi']);
    await searchCities('li');
    expect(mockResult).toHaveBeenCalledTimes(1);
  });

  it('falls back to the static DRC list on a network error', async () => {
    mockResult.mockRejectedValue(new Error('offline'));
    const r = await searchCities('kins');
    expect(r.map((c) => c.name)).toEqual(['Kinshasa']);
    mockResult.mockResolvedValue({ data: null, error: { message: 'boom' } });
    resetGeoCache();
    expect((await loadCities('CD')).length).toBeGreaterThan(5);
  });

  it('returns communes of the typed city only, none without a city', async () => {
    mockResult.mockRejectedValue(new Error('offline'));
    expect(await searchCommunes('', '')).toEqual([]);
    expect((await searchCommunes('kinshasa', 'GO')).map((c) => c.name)).toEqual(['Gombe']);
    expect((await searchCommunes('Goma', 'ka')).map((c) => c.name)).toEqual(['Karisimbi']);
    expect(await searchCommunes('Ville inconnue', '')).toEqual([]);
  });
});

describe('recordPlaceIfNew', () => {
  it('calls the RPCs for an unknown free entry', async () => {
    mockResult.mockResolvedValue({ data: rows, error: null });
    await recordPlaceIfNew('Nouvelleville', 'Centre', 'CD');
    expect(mockRpc).toHaveBeenCalledWith('record_city_if_not_exists', { p_name: 'Nouvelleville', p_country_code: 'CD' });
    expect(mockRpc).toHaveBeenCalledWith('record_commune_if_not_exists', { p_city_id: 'new-id', p_name: 'Centre' });
  });
  it('never throws on RPC failure', async () => {
    mockResult.mockResolvedValue({ data: rows, error: null });
    mockRpc.mockRejectedValue(new Error('offline'));
    await expect(recordPlaceIfNew('Autre', '', 'CD')).resolves.toBeUndefined();
  });
});
