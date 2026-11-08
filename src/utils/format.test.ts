import { formatAmountInCurrency, formatDoctorFee } from './format';

// Espaces insécables/fines selon l'ICU : on normalise pour comparer au littéral.
const flat = (s: string | null) => (s === null ? null : s.replace(/\s/g, ' '));

describe('formatDoctorFee', () => {
  it('formats a fee with the symbol of its currency code', () => {
    expect(flat(formatDoctorFee(15000, 'CDF'))).toBe('15 000 FC');
    expect(flat(formatDoctorFee(15000, 'XOF'))).toBe('15 000 F CFA');
  });

  it('falls back to the ISO code for a currency the app does not know', () => {
    expect(flat(formatDoctorFee(15000, 'KES'))).toBe('15 000 KES');
  });

  it('uses the fallback country when the view gives no currency', () => {
    expect(flat(formatDoctorFee(15000, null))).toBe('15 000 FC');
  });

  it('returns null (never "null" or "NaN") when the fee is hidden or invalid', () => {
    expect(formatDoctorFee(null, 'CDF')).toBeNull();
    expect(formatDoctorFee(undefined, null)).toBeNull();
    expect(formatDoctorFee(NaN, 'CDF')).toBeNull();
  });
});

describe('formatAmountInCurrency (revenus : jamais la devise du pays actif pour une devise inconnue)', () => {
  it('devise connue : symbole habituel', () => {
    expect(flat(formatAmountInCurrency(15000, 'CDF'))).toBe('15 000 FC');
    expect(flat(formatAmountInCurrency(120, 'USD'))).toContain('120');
  });
  it('devise null / vide : le nombre seul, sans symbole ni code', () => {
    expect(flat(formatAmountInCurrency(15000, null))).toBe('15 000');
    expect(flat(formatAmountInCurrency(12.5, ''))).toBe('12,5');
  });
});
