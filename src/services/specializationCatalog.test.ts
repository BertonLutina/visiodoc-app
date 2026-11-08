const { specKey, specCode, mergeCatalog, suggestSpecializations } = require('./specializationCatalog');

describe('specialization catalog', () => {
  it('normalizes keys like the database', () => {
    expect(specKey('  Pédiatrie ')).toBe('pediatrie');
  });
  it('builds a stable code', () => {
    expect(specCode('Médecine du sport')).toBe('MEDECINE_DU_SPORT');
  });
  it('merges without duplicates, accent-insensitive', () => {
    expect(mergeCatalog(['Pédiatrie', 'Cardiologie'], ['pediatrie', 'Zoothérapie'])).toEqual([
      'Cardiologie',
      'Pédiatrie',
      'Zoothérapie',
    ]);
  });
  it('returns only labels missing from the official list', async () => {
    const out = await suggestSpecializations('u1', ['Cardiologie', 'Rolfing'], ['Cardiologie']);
    expect(out).toEqual(['Rolfing']);
  });
});
