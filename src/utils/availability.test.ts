import { hasOverlappingRanges } from './availability';

describe('hasOverlappingRanges', () => {
  it('is false for non-overlapping ranges', () => {
    expect(
      hasOverlappingRanges([
        { start: '09:00', end: '12:00' },
        { start: '13:00', end: '17:00' },
      ]),
    ).toBe(false);
  });

  it('is false for a single range', () => {
    expect(hasOverlappingRanges([{ start: '09:00', end: '12:00' }])).toBe(false);
  });

  it('is false for back-to-back ranges that only touch at the boundary', () => {
    expect(
      hasOverlappingRanges([
        { start: '09:00', end: '12:00' },
        { start: '12:00', end: '17:00' },
      ]),
    ).toBe(false);
  });

  it('is true when one range starts before the previous one ends', () => {
    expect(
      hasOverlappingRanges([
        { start: '09:00', end: '12:00' },
        { start: '10:00', end: '14:00' },
      ]),
    ).toBe(true);
  });

  it('is true regardless of input order', () => {
    expect(
      hasOverlappingRanges([
        { start: '10:00', end: '14:00' },
        { start: '09:00', end: '12:00' },
      ]),
    ).toBe(true);
  });
});
