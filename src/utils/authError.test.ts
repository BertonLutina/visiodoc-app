import { authErrorMessage, edgeFunctionError, mapDuplicateContactError } from './authError';
import { setCurrentLangCode } from '@/i18n/core';

describe('authErrorMessage and session expiry', () => {
  it('shows the guide text for an expired session', () => {
    expect(authErrorMessage({ code: 'session_expired', message: 'Session expired', status: 401 })).toBe(
      'Ta session a expiré, reconnecte-toi.',
    );
    expect(authErrorMessage(new Error('Invalid Refresh Token: Session Expired'))).toBe(
      'Ta session a expiré, reconnecte-toi.',
    );
  });

  it('keeps the wrong-password text for invalid credentials', () => {
    expect(authErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe(
      'Email ou mot de passe incorrect.',
    );
  });
});

describe('mapDuplicateContactError (23505 on users.phone / users.email)', () => {
  afterEach(() => setCurrentLangCode('fr'));

  it('phone unique violation → phone message, never the raw error', () => {
    const raw = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "users_phone_key"',
      details: 'Key (phone)=(+243810000000) already exists.',
    };
    const mapped = mapDuplicateContactError(raw) as Error;
    expect(mapped).toBeInstanceOf(Error);
    expect(authErrorMessage(mapped)).toBe('Ce numéro de téléphone est déjà utilisé par un autre compte.');
    setCurrentLangCode('sw');
    expect(authErrorMessage(mapDuplicateContactError(raw))).toBe('Nambari hii ya simu tayari inatumiwa na akaunti nyingine.');
  });

  it('phone detail only in details → phone message', () => {
    const mapped = mapDuplicateContactError({ code: '23505', message: 'duplicate key', details: 'Key (phone)=(x) already exists.' });
    expect(authErrorMessage(mapped)).toBe('Ce numéro de téléphone est déjà utilisé par un autre compte.');
  });

  it('email unique violation → existing e-mail already used message', () => {
    const mapped = mapDuplicateContactError({ code: '23505', message: 'violates unique constraint "users_email_key"' });
    expect(authErrorMessage(mapped)).toBe('Un compte existe déjà avec cet email.');
  });

  it('other errors are returned untouched', () => {
    const other = { code: '23514', message: 'phone check' };
    expect(mapDuplicateContactError(other)).toBe(other);
  });

  it('edgeFunctionError translates the phone 409 message of register-presta', () => {
    setCurrentLangCode('en');
    expect(edgeFunctionError({ error: 'Ce numéro de téléphone est déjà utilisé par un autre compte.' }).message).toBe(
      'This phone number is already used by another account.',
    );
  });
});
