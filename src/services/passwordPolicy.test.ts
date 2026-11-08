import { passwordIssue, passwordStrength } from './passwordPolicy';
import { setCurrentLangCode } from '@/i18n/core';
import { authErrorMessage, pwnedPasswordMessage } from '@/utils/authError';

const PWNED = 'Ce mot de passe a déjà fuité sur Internet, choisis-en un autre.';

describe('passwordIssue (guide MOB-0611-3 : 10-72 caractères, une lettre, un chiffre)', () => {
  it('rejects passwords shorter than 10 characters', () => {
    expect(passwordIssue('short1')).toBe('too_short');
    expect(passwordIssue('abcdefgh1')).toBe('too_short'); // 9 caractères
    expect(passwordIssue('')).toBe('too_short');
  });

  it('rejects passwords longer than 72 characters', () => {
    expect(passwordIssue('a1' + 'x'.repeat(71))).toBe('too_long'); // 73 caractères
  });

  it('requires at least one letter and one digit', () => {
    expect(passwordIssue('abcdefghij')).toBe('needs_letter_and_digit');
    expect(passwordIssue('1234567890')).toBe('needs_letter_and_digit');
  });

  it('accepts valid passwords, with no symbol required', () => {
    expect(passwordIssue('VisioDoc2026')).toBeNull();
    expect(passwordIssue('abcdefghi1')).toBeNull(); // exactement 10
    expect(passwordIssue('a1' + 'x'.repeat(70))).toBeNull(); // exactement 72
    expect(passwordIssue('VisioDoc2026!')).toBeNull();
  });
});

describe('passwordStrength', () => {
  it('is weak while the policy is not met, correct once met, strong when long', () => {
    expect(passwordStrength('short1')).toBe('weak');
    expect(passwordStrength('abcdefghij')).toBe('weak');
    expect(passwordStrength('VisioDoc2026')).toBe('ok');
    expect(passwordStrength('VisioDoc2026Kinshasa')).toBe('strong');
  });
});

describe('pwnedPasswordMessage (HTTP 422 weak_password / pwned)', () => {
  it('returns the guide text for the GoTrue body', () => {
    expect(pwnedPasswordMessage({ error_code: 'weak_password', reasons: ['pwned'] })).toBe(PWNED);
    expect(
      pwnedPasswordMessage({
        code: 422,
        error_code: 'weak_password',
        msg: 'Password is known to be weak and easy to guess',
        reasons: ['pwned'],
      }),
    ).toBe(PWNED);
  });

  it('matches on the error message when the body is not available', () => {
    expect(pwnedPasswordMessage(new Error('Password is known to be weak and easy to guess'))).toBe(PWNED);
    expect(pwnedPasswordMessage(new Error('weak_password: pwned'))).toBe(PWNED);
    expect(pwnedPasswordMessage({ message: 'Mot de passe pwned' })).toBe(PWNED);
  });

  it('returns null for other errors, including weak_password for another reason', () => {
    expect(pwnedPasswordMessage(new Error('Invalid login credentials'))).toBeNull();
    expect(pwnedPasswordMessage({ error_code: 'weak_password', reasons: ['length'] })).toBeNull();
    expect(pwnedPasswordMessage(null)).toBeNull();
    expect(pwnedPasswordMessage(undefined)).toBeNull();
    expect(pwnedPasswordMessage('boom')).toBeNull();
  });

  describe('translated copy (guide MOB-0612-2 §3)', () => {
    afterEach(() => setCurrentLangCode('fr'));

    it.each([
      ['en', 'This password has previously appeared in a data leak, please choose a different one.'],
      ['ln', 'Mot de passe oyo ebimi déjà na Internet, pona mosusu.'],
      ['sw', 'Nenosiri hili limeshavuja kwenye Mtandao, chagua jingine.'],
    ] as const)('shows the guide text in %s', (code, expected) => {
      setCurrentLangCode(code);
      expect(pwnedPasswordMessage({ error_code: 'weak_password', reasons: ['pwned'] })).toBe(expected);
    });
  });

  it('is what authErrorMessage shows for a pwned refusal', () => {
    expect(authErrorMessage({ error_code: 'weak_password', reasons: ['pwned'], message: 'x' })).toBe(PWNED);
  });

  it('shows the 10-character rule instead of the old 6-character one', () => {
    expect(authErrorMessage({ message: 'Password should be at least 6 characters' })).toBe(
      'Le mot de passe doit comporter au moins 10 caractères et inclure au moins une lettre et un chiffre.',
    );
  });
});
