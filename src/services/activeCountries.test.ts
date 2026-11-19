import {
  fallbackCountries,
  getActiveCountries,
  knownActiveCountries,
  openSignupCountries,
  resetActiveCountriesCache,
} from './activeCountries';

const mockResult = jest.fn();
const mockSelect = jest.fn();
const mockColumns = jest.fn();
const mockEq = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabasePublic: {
    from: (...a: unknown[]) => {
      mockSelect(...a);
      const chain: any = {
        select: (...s: unknown[]) => (mockColumns(...s), chain),
        eq: (...e: unknown[]) => (mockEq(...e), chain),
        order: () => mockResult(),
      };
      return chain;
    },
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  resetActiveCountriesCache();
});

describe('activeCountries', () => {
  it('keeps only active countries known by the app', () => {
    const list = knownActiveCountries(['CD', 'CM', 'XX']);
    expect(list.map((c) => c.code).sort()).toEqual(['CD', 'CM']);
  });

  it('returns active ∩ known from the database', async () => {
    mockResult.mockResolvedValue({ data: [{ code: 'CD' }, { code: 'ZZ' }], error: null });
    const list = await getActiveCountries();
    expect(list.map((c) => c.code)).toEqual(['CD']);
    expect(mockSelect).toHaveBeenCalledWith('countries');
  });

  it('falls back to DRC only on error', async () => {
    mockResult.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect((await getActiveCountries()).map((c) => c.code)).toEqual(['CD']);
    expect(fallbackCountries()).toHaveLength(1);
  });

  it('falls back to DRC when the call throws', async () => {
    mockResult.mockRejectedValue(new Error('network'));
    expect((await getActiveCountries()).map((c) => c.code)).toEqual(['CD']);
  });

  it('caches a successful read', async () => {
    mockResult.mockResolvedValue({ data: [{ code: 'CD' }, { code: 'CM' }], error: null });
    await getActiveCountries();
    await getActiveCountries();
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it('does not cache failures', async () => {
    mockResult.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    await getActiveCountries();
    mockResult.mockResolvedValueOnce({ data: [{ code: 'CD' }, { code: 'CM' }], error: null });
    expect((await getActiveCountries()).map((c) => c.code).sort()).toEqual(['CD', 'CM']);
  });

  it('reads countries.signup_open (anon) and filters on it', async () => {
    mockResult.mockResolvedValue({ data: [{ code: 'CD' }, { code: 'CM' }], error: null });
    expect((await getActiveCountries()).map((c) => c.code)).toEqual(['CM', 'CD']);
    expect(mockColumns).toHaveBeenCalledWith('code, signup_open');
    expect(mockEq).toHaveBeenCalledWith('is_active', true);
    expect(mockEq).toHaveBeenCalledWith('signup_open', true);
    expect(openSignupCountries(['CM', 'XX']).map((c) => c.code)).toEqual(['CM']);
  });

  it('falls back to DRC only when the signup_open column is not applied yet (unknown column)', async () => {
    mockResult.mockResolvedValue({
      data: null,
      error: { code: '42703', message: 'column countries.signup_open does not exist' },
    });
    expect((await getActiveCountries()).map((c) => c.code)).toEqual(['CD']);
  });

  it('falls back to DRC when the server returns no open country', async () => {
    mockResult.mockResolvedValue({ data: [], error: null });
    expect((await getActiveCountries()).map((c) => c.code)).toEqual(['CD']);
  });
});
