import { greetingName, identityNamesComplete, identityNamesIssue } from './identityNames';
import { setCurrentLangCode } from '@/i18n/core';

beforeEach(() => setCurrentLangCode('fr'));

describe('identityNamesComplete', () => {
  it('always requires the last name', () => {
    expect(identityNamesComplete({ firstName: 'Jean', postNom: 'Mbala' }, true)).toBe(false);
    expect(identityNamesComplete({ firstName: 'Jean', lastName: '  ' }, false)).toBe(false);
  });

  it('postnom country: first name OR post-nom, both allowed', () => {
    expect(identityNamesComplete({ lastName: 'Kanza', firstName: 'Jean' }, true)).toBe(true);
    expect(identityNamesComplete({ lastName: 'Kanza', postNom: 'Mbala' }, true)).toBe(true);
    expect(identityNamesComplete({ lastName: 'Kanza', firstName: 'Jean', postNom: 'Mbala' }, true)).toBe(true);
    expect(identityNamesComplete({ lastName: 'Kanza', firstName: ' ', postNom: ' ' }, true)).toBe(false);
  });

  it('other countries: first name required, post-nom alone is not enough', () => {
    expect(identityNamesComplete({ lastName: 'Kanza', firstName: 'Jean' }, false)).toBe(true);
    expect(identityNamesComplete({ lastName: 'Kanza', postNom: 'Mbala' }, false)).toBe(false);
  });
});

describe('identityNamesIssue', () => {
  it('returns null when valid and a translated message otherwise', () => {
    expect(identityNamesIssue({ lastName: 'K', postNom: 'M' }, true)).toBeNull();
    expect(identityNamesIssue({ lastName: 'K' }, true)).toBe('Le nom est obligatoire, ainsi que le prénom ou le post-nom.');
    expect(identityNamesIssue({ lastName: 'K' }, false)).toBe('Le nom et le prénom sont obligatoires.');
    setCurrentLangCode('en');
    expect(identityNamesIssue({ lastName: 'K' }, true)).toBe('Last name is required, along with first name or post-nom.');
  });
});

describe('greetingName', () => {
  it('prefers the first name', () => {
    expect(greetingName({ firstName: ' Jean ', postNom: 'Mbala', lastName: 'Kabila' })).toBe('Jean');
  });
  it('falls back to the post-nom when there is no first name', () => {
    expect(greetingName({ firstName: '  ', postNom: 'Mbala', lastName: 'Kabila' })).toBe('Mbala');
  });
  it('falls back to the last name, then to empty', () => {
    expect(greetingName({ lastName: 'Kabila' })).toBe('Kabila');
    expect(greetingName({})).toBe('');
  });
});
