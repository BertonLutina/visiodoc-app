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

describe('toE164 literal cases (final review)', () => {
  it.each([
    ['+243 899 999 999', '+243899999999'],
    ['+243-899-999-999', '+243899999999'],
    ['0899999999', '+243899999999'],
    ['899999999', '+243899999999'],
    ['00243899999999', '+243899999999'],
    ['243899999999', '+243899999999'],
    ['243 899 999 999', '+243899999999'],
  ])('%s -> %s (never a doubled country code)', (input, expected) => {
    expect(toE164(input, '+243')).toBe(expected);
  });

  it('treats digits already starting with the Niger code (8-digit numbers) as international', () => {
    expect(toE164('22790123456', '+227')).toBe('+22790123456');
  });

  it('still prefixes a local number that merely starts with the dial digits but is too short', () => {
    expect(toE164('243123456', '+243')).toBe('+243243123456');
  });

  it("returns undefined (invalid marker) for zeros only, not '+'", () => {
    expect(toE164('000', '+243')).toBeUndefined();
    expect(toE164('00', '+243')).toBeUndefined();
    expect(toE164('0', '+243')).toBeUndefined();
  });
});


describe('toE164 with a world dialling code (Belgium, Portugal, France)', () => {
  it('converts a Belgian national number with +32', () => {
    expect(toE164('0475 12 34 56', '+32')).toBe('+32475123456');
    expect(toE164('475123456', '+32')).toBe('+32475123456');
  });
  it('does not double-prefix a Belgian number typed with its code', () => {
    expect(toE164('32475123456', '+32')).toBe('+32475123456');
    expect(toE164('+32475123456', '+243')).toBe('+32475123456');
    expect(toE164('0032475123456', '+243')).toBe('+32475123456');
  });
});
