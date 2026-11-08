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

describe('consultation type mapping (DB CHECK allows only video | audio | chat)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const f = () => require('./format');

  it('maps the UI "phone" choice to the DB value "audio" and keeps the others', () => {
    expect(f().toDbConsultationType('phone')).toBe('audio');
    expect(f().toDbConsultationType('video')).toBe('video');
    expect(f().toDbConsultationType('chat')).toBe('chat');
  });

  it('maps DB values to UI types: audio -> phone, unknown/absent -> video', () => {
    expect(f().fromDbConsultationType('audio')).toBe('phone');
    expect(f().fromDbConsultationType('video')).toBe('video');
    expect(f().fromDbConsultationType('chat')).toBe('chat');
    expect(f().fromDbConsultationType('phone')).toBe('phone');
    expect(f().fromDbConsultationType('hologram')).toBe('video');
    expect(f().fromDbConsultationType(null)).toBe('video');
    expect(f().fromDbConsultationType(undefined)).toBe('video');
  });

  it.each([
    ['video', 'Vidéo', 'video'],
    ['audio', 'Téléphone', 'phone'],
    ['chat', 'Chat', 'message-circle'],
    ['phone', 'Téléphone', 'phone'],
  ])('every value (%s) has a label and an icon', (value, label, icon) => {
    expect(f().typeLabel(value)).toBe(label);
    expect(f().typeIcon(value)).toBe(icon);
  });

  it('never returns undefined for an unknown value', () => {
    for (const v of ['', 'weird', null, undefined]) {
      expect(typeof f().typeLabel(v)).toBe('string');
      expect(f().typeLabel(v)).not.toBe('');
      expect(typeof f().typeIcon(v)).toBe('string');
    }
  });
});
