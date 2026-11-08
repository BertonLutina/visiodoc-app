import { isSessionExpiry, onSessionExpired, reportSessionExpiry } from './sessionExpiry';

describe('isSessionExpiry', () => {
  it('is true for the code session_expired', () => {
    expect(isSessionExpiry({ code: 'session_expired' })).toBe(true);
  });

  it('is true for the code refresh_token_not_found', () => {
    expect(isSessionExpiry({ code: 'refresh_token_not_found' })).toBe(true);
  });

  it('is true for the message "Invalid Refresh Token: Session Expired"', () => {
    expect(isSessionExpiry(new Error('Invalid Refresh Token: Session Expired'))).toBe(true);
  });

  it('is true for the message "JWT expired"', () => {
    expect(isSessionExpiry(new Error('JWT expired'))).toBe(true);
  });

  it('recognises the plain-string forms', () => {
    expect(isSessionExpiry('session_expired')).toBe(true);
    expect(isSessionExpiry('refresh_token_not_found')).toBe(true);
    expect(isSessionExpiry('Invalid Refresh Token: Session Expired')).toBe(true);
    expect(isSessionExpiry('JWT expired')).toBe(true);
  });

  it('is true for a reused (rotated) refresh token', () => {
    expect(isSessionExpiry({ code: 'refresh_token_already_used' })).toBe(true);
    expect(isSessionExpiry(new Error('Invalid Refresh Token: Already Used'))).toBe(true);
    expect(isSessionExpiry('refresh_token_already_used')).toBe(true);
    expect(
      isSessionExpiry({
        name: 'AuthApiError',
        code: 'refresh_token_already_used',
        message: 'Invalid Refresh Token: Already Used',
        status: 400,
      }),
    ).toBe(true);
  });

  it('recognises the GoTrue wording of a missing refresh token', () => {
    expect(isSessionExpiry(new Error('Invalid Refresh Token: Refresh Token Not Found'))).toBe(true);
  });

  it('matches free-text messages case-insensitively', () => {
    expect(isSessionExpiry({ message: 'jwt EXPIRED' })).toBe(true);
    expect(isSessionExpiry({ message: 'invalid refresh token: session expired' })).toBe(true);
  });

  it('recognises AuthError-shaped objects ({ code, message, status })', () => {
    expect(
      isSessionExpiry({ name: 'AuthApiError', code: 'session_expired', message: 'Session expired', status: 401 }),
    ).toBe(true);
    expect(
      isSessionExpiry({
        name: 'AuthApiError',
        code: 'refresh_token_not_found',
        message: 'Invalid Refresh Token: Refresh Token Not Found',
        status: 400,
      }),
    ).toBe(true);
  });

  it('recognises a PostgREST error carrying "JWT expired"', () => {
    expect(isSessionExpiry({ code: 'PGRST301', message: 'JWT expired', details: null, hint: null })).toBe(true);
  });

  it('recognises objects with only a message or only a code', () => {
    expect(isSessionExpiry({ message: 'JWT expired' })).toBe(true);
    expect(isSessionExpiry({ code: 'session_expired' })).toBe(true);
  });

  it('is false for a wrong password', () => {
    expect(isSessionExpiry(new Error('Invalid login credentials'))).toBe(false);
    expect(
      isSessionExpiry({ name: 'AuthApiError', code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 }),
    ).toBe(false);
    expect(isSessionExpiry('Invalid login credentials')).toBe(false);
  });

  it('is false for null, undefined and non-error values', () => {
    expect(isSessionExpiry(null)).toBe(false);
    expect(isSessionExpiry(undefined)).toBe(false);
    expect(isSessionExpiry(42)).toBe(false);
    expect(isSessionExpiry(true)).toBe(false);
    expect(isSessionExpiry({})).toBe(false);
    expect(isSessionExpiry([])).toBe(false);
    expect(isSessionExpiry('')).toBe(false);
  });

  it('is false for unrelated network errors', () => {
    expect(isSessionExpiry(new TypeError('Network request failed'))).toBe(false);
    expect(isSessionExpiry({ name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 })).toBe(false);
  });

  it('is false for an expired one-time code (not a session)', () => {
    expect(isSessionExpiry({ code: 'otp_expired', message: 'Token has expired or is invalid' })).toBe(false);
  });
});

describe('reportSessionExpiry', () => {
  it('notifies listeners and returns true for an expiry error', () => {
    const listener = jest.fn();
    const off = onSessionExpired(listener);
    expect(reportSessionExpiry({ code: 'PGRST301', message: 'JWT expired' })).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it('does nothing and returns false for any other error', () => {
    const listener = jest.fn();
    const off = onSessionExpired(listener);
    expect(reportSessionExpiry(new Error('Invalid login credentials'))).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    off();
  });

  it('stops notifying a listener once it unsubscribed', () => {
    const listener = jest.fn();
    onSessionExpired(listener)();
    reportSessionExpiry('JWT expired');
    expect(listener).not.toHaveBeenCalled();
  });
});
