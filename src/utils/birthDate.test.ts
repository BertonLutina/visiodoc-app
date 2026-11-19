import {
  ageOn,
  birthDateIssue,
  birthDateMessage,
  isAtLeast18,
  latestBirthDate,
  normalizePlace,
  parseIsoDate,
} from './birthDate';
import { setCurrentLangCode } from '@/i18n/core';

// Mardi 17 novembre 2026, heure locale.
const TODAY = new Date(2026, 10, 17, 12, 0, 0);

describe('parseIsoDate', () => {
  it('accepts a real calendar date and rejects the rest', () => {
    expect(parseIsoDate('2000-02-29')).toEqual({ y: 2000, m: 2, d: 29 });
    expect(parseIsoDate('2001-02-29')).toBeNull();
    expect(parseIsoDate('2001-13-01')).toBeNull();
    expect(parseIsoDate('17/11/2000')).toBeNull();
    expect(parseIsoDate('2000-1-1')).toBeNull();
  });
});

describe('ageOn', () => {
  it('counts completed years only', () => {
    expect(ageOn({ y: 2008, m: 11, d: 17 }, TODAY)).toBe(18);
    expect(ageOn({ y: 2008, m: 11, d: 18 }, TODAY)).toBe(17);
    expect(ageOn({ y: 2008, m: 12, d: 1 }, TODAY)).toBe(17);
  });
});

describe('birthDateIssue (MOB-1211-1)', () => {
  it('requires a value', () => {
    expect(birthDateIssue('', TODAY)).toBe('required');
    expect(birthDateIssue('   ', TODAY)).toBe('required');
    expect(birthDateIssue(undefined, TODAY)).toBe('required');
    expect(birthDateIssue(null, TODAY)).toBe('required');
  });

  it('flags a malformed date', () => {
    expect(birthDateIssue('1990-02-30', TODAY)).toBe('invalid');
    expect(birthDateIssue('hier', TODAY)).toBe('invalid');
  });

  it('accepts exactly 18 years completed today, refuses the day before the birthday', () => {
    expect(birthDateIssue('2008-11-17', TODAY)).toBeNull();
    expect(birthDateIssue('2008-11-18', TODAY)).toBe('underage');
  });

  it('refuses minors, future dates and ages above 125', () => {
    expect(birthDateIssue('2015-05-05', TODAY)).toBe('underage');
    expect(birthDateIssue('2027-01-01', TODAY)).toBe('underage');
    expect(birthDateIssue('1900-01-01', TODAY)).toBe('underage');
    expect(birthDateIssue('1901-11-17', TODAY)).toBeNull();
  });

  it('accepts an adult', () => {
    expect(isAtLeast18('1990-06-15', TODAY)).toBe(true);
    expect(isAtLeast18('', TODAY)).toBe(false);
  });
});

describe('birthDateMessage', () => {
  afterEach(() => setCurrentLangCode('fr'));

  it('uses the server wording for a minor', () => {
    expect(birthDateMessage('underage')).toBe('Vous devez avoir au moins 18 ans révolus pour vous inscrire.');
  });

  it('is translated', () => {
    setCurrentLangCode('en');
    expect(birthDateMessage('underage')).not.toBe('Vous devez avoir au moins 18 ans révolus pour vous inscrire.');
  });
});

describe('latestBirthDate', () => {
  it('is today minus 18 years', () => {
    expect(latestBirthDate(TODAY)).toBe('2008-11-17');
  });
});

describe('normalizePlace', () => {
  it('trims, drops empty values and flags a value over 100 characters', () => {
    expect(normalizePlace('  Matadi ')).toBe('Matadi');
    expect(normalizePlace('   ')).toBeUndefined();
    expect(normalizePlace(undefined)).toBeUndefined();
    expect(normalizePlace('a'.repeat(100))).toBe('a'.repeat(100));
    expect(normalizePlace('a'.repeat(101))).toBeNull();
  });
});
