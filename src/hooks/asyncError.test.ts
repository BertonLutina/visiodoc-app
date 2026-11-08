import { onSessionExpired } from '@/services/sessionExpiry';
import { handleLoadError } from './asyncError';

describe('handleLoadError (shared data-load catch)', () => {
  let calls = 0;
  let off: () => void;
  beforeEach(() => {
    calls = 0;
    off = onSessionExpired(() => {
      calls += 1;
    });
  });
  afterEach(() => off());

  it('reports a bare "JWT expired" data error exactly once and still returns its message', () => {
    expect(handleLoadError({ code: 'PGRST301', message: 'JWT expired' })).toBe('JWT expired');
    expect(calls).toBe(1);
  });

  it('reports a refresh-token expiry error', () => {
    handleLoadError(Object.assign(new Error('Invalid Refresh Token: Refresh Token Not Found'), { code: 'refresh_token_not_found' }));
    expect(calls).toBe(1);
  });

  it('does not report any other error and keeps today’s message behaviour', () => {
    expect(handleLoadError(new Error('network down'))).toBe('network down');
    expect(handleLoadError({ code: '42501', message: 'permission denied' })).toBe('permission denied');
    expect(calls).toBe(0);
  });

  it('falls back to the generic message when the error has none', () => {
    expect(handleLoadError(undefined)).toBe('Erreur de chargement');
    expect(handleLoadError({})).toBe('Erreur de chargement');
    expect(calls).toBe(0);
  });
});
