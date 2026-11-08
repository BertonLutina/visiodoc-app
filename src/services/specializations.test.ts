const { parseSpecializations, dedupeSpecializations, joinSpecializations } = require('./specializations');

describe('specializations helpers', () => {
  it('parses strings and arrays and keeps a single specialty', () => {
    expect(parseSpecializations('Cardiologie · Pédiatrie')).toEqual(['Cardiologie']);
    expect(parseSpecializations(['A', 'B'])).toEqual(['A']);
    expect(parseSpecializations(null)).toEqual([]);
  });
  it('dedupes ignoring accents/case and keeps the first specialty', () => {
    expect(dedupeSpecializations(['Pédiatrie', 'pediatrie', 'a', 'b'])).toEqual(['Pédiatrie']);
  });
  it('joins', () => {
    expect(joinSpecializations(['A', 'B'])).toBe('A · B');
  });
});
