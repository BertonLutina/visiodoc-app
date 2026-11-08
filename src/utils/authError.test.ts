import { authErrorMessage } from './authError';

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
