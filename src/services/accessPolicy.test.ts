import { mobileRole } from './accessPolicy';
import {
  ROLE_NOT_ALLOWED,
  authErrorMessage,
  isRoleNotAllowed,
  roleNotAllowedError,
} from '@/utils/authError';
import { setCurrentLangCode } from '@/i18n/core';

describe('mobileRole', () => {
  it.each(['country_admin', 'COUNTRY_ADMIN', 'provider_validator', 'PROVIDER_VALIDATOR'])(
    'refuses the web-only role %s',
    (role) => {
      expect(mobileRole(role)).toBeNull();
    },
  );

  it.each(['super_admin', 'SUPER_ADMIN', 'admin', 'ADMIN'])('refuses the administrator role %s', (role) => {
    expect(mobileRole(role)).toBeNull();
  });

  it('opens the provider space for provider and doctor, whatever the case', () => {
    expect(mobileRole('doctor')).toBe('provider');
    expect(mobileRole('DOCTOR')).toBe('provider');
    expect(mobileRole('provider')).toBe('provider');
    expect(mobileRole('PROVIDER')).toBe('provider');
  });

  it('opens the patient space for patient, whatever the case', () => {
    expect(mobileRole('patient')).toBe('patient');
    expect(mobileRole('PATIENT')).toBe('patient');
  });

  it('refuses an empty, missing or unknown role instead of treating it as a patient', () => {
    expect(mobileRole('')).toBeNull();
    expect(mobileRole(null)).toBeNull();
    expect(mobileRole(undefined)).toBeNull();
    expect(mobileRole('foo')).toBeNull();
  });
});

describe('role refusal message', () => {
  afterEach(() => setCurrentLangCode('fr'));

  it("shows the exact text of the guide, with the final period", () => {
    setCurrentLangCode('fr');
    expect(authErrorMessage(roleNotAllowedError())).toBe("Vous n'êtes pas autorisé ici, utilisez la version web.");
  });

  it('is translated in English', () => {
    setCurrentLangCode('en');
    expect(authErrorMessage(roleNotAllowedError())).toBe('You are not authorised here, please use the web version.');
  });

  it('is recognised by its code and not confused with another error', () => {
    expect(roleNotAllowedError().message).toBe(ROLE_NOT_ALLOWED);
    expect(isRoleNotAllowed(roleNotAllowedError())).toBe(true);
    expect(isRoleNotAllowed(new Error('Invalid login credentials'))).toBe(false);
    expect(isRoleNotAllowed(null)).toBe(false);
  });
});
