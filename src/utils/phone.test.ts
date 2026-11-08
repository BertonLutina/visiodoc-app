import { toE164 } from './phone';

describe('toE164 (local or international input -> +<dial><national>)', () => {
  it('converts a local number with a leading 0', () => {
    expect(toE164('0899999999', '+243')).toBe('+243899999999');
  });

  it('converts a local number without the leading 0', () => {
    expect(toE164('899999999', '+243')).toBe('+243899999999');
  });

  it('drops spaces and separators of a +international number without double-prefixing', () => {
    expect(toE164('+243 899 999 999', '+243')).toBe('+243899999999');
    expect(toE164('+243 81 234 5678', '+243')).toBe('+243812345678');
    expect(toE164('+243-899-999-999', '+243')).toBe('+243899999999');
  });

  it('converts a 00-prefixed international number without double-prefixing', () => {
    expect(toE164('00243899999999', '+243')).toBe('+243899999999');
  });

  it('leaves a number already in E.164 unchanged', () => {
    expect(toE164('+243899999999', '+243')).toBe('+243899999999');
    expect(toE164('+227 90 12 34 56', '+243')).toBe('+22790123456');
  });

  it("uses the chosen country's dial code (Niger)", () => {
    expect(toE164('90 12 34 56', '+227')).toBe('+22790123456');
  });

  it('returns undefined for empty, blank or digit-less input', () => {
    expect(toE164('', '+243')).toBeUndefined();
    expect(toE164('   ', '+243')).toBeUndefined();
    expect(toE164(undefined, '+243')).toBeUndefined();
    expect(toE164('+', '+243')).toBeUndefined();
    expect(toE164('abc', '+243')).toBeUndefined();
  });
});
