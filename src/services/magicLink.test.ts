import {
  MagicLinkError,
  magicLinkCooldownRemaining,
  magicLinkErrorMessage,
  markMagicLinkSent,
  parseMagicLinkToken,
  requestMagicLink,
  resetMagicLinkCooldowns,
  verifyMagicLinkToken,
} from './magicLink';

// Seule frontière simulée : `@/lib/supabase` (Edge Functions `magic-link-request` / `magic-link-verify`).
const mockInvoke = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabaseConfigured: true,
  supabase: { functions: { invoke: (...a: unknown[]) => mockInvoke(...a) } },
  supabasePublic: null,
}));

/** Erreur telle que la renvoie supabase-js : FunctionsHttpError avec la `Response` dans `context`. */
const httpError = (status: number, body: unknown) => ({
  name: 'FunctionsHttpError',
  message: 'Edge Function returned a non-2xx status code',
  context: new Response(JSON.stringify(body), { status }),
});

const TOKEN = 'a1b2c3d4'.repeat(8); // 64 caractères hexadécimaux

beforeEach(() => {
  jest.clearAllMocks();
  resetMagicLinkCooldowns();
});

describe('parseMagicLinkToken', () => {
  it('accepts 64 hex characters (trimmed, first value of an array)', () => {
    expect(parseMagicLinkToken(TOKEN)).toBe(TOKEN);
    expect(parseMagicLinkToken(`  ${TOKEN}\n`)).toBe(TOKEN);
    expect(parseMagicLinkToken([TOKEN, 'x'])).toBe(TOKEN);
  });

  it.each([undefined, null, '', 'abc', TOKEN.slice(1), `${TOKEN}0`, 'g'.repeat(64), 42, {}])(
    'rejects %p',
    (raw) => {
      expect(parseMagicLinkToken(raw)).toBeNull();
    },
  );
});

describe('requestMagicLink', () => {
  it('posts the normalised email to magic-link-request and starts the 60 s cooldown', async () => {
    mockInvoke.mockResolvedValue({ data: { message: 'ok' }, error: null });
    await requestMagicLink('  Marie@Example.com ');
    expect(mockInvoke).toHaveBeenCalledWith('magic-link-request', { body: { email: 'marie@example.com' } });
    expect(magicLinkCooldownRemaining('MARIE@example.com')).toBeGreaterThan(0);
    expect(magicLinkCooldownRemaining('autre@example.com')).toBe(0);
  });

  it('maps HTTP 429 to rate_limited without starting a cooldown', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(429, { error: 'Veuillez patienter 60 secondes' }) });
    await expect(requestMagicLink('a@b.co')).rejects.toMatchObject({ kind: 'rate_limited' });
    expect(magicLinkCooldownRemaining('a@b.co')).toBe(0);
  });

  it('keeps the server message of a 403 (disabled account)', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(403, { error: 'Votre compte est désactivé.' }) });
    const error = await requestMagicLink('a@b.co').catch((e) => e);
    expect(error).toBeInstanceOf(MagicLinkError);
    expect(error.kind).toBe('forbidden');
    expect(magicLinkErrorMessage(error)).toBe('Votre compte est désactivé.');
  });
});

describe('cooldown', () => {
  it('counts down from 60 s and reaches 0', () => {
    markMagicLinkSent('a@b.co', 1_000);
    expect(magicLinkCooldownRemaining('a@b.co', 1_000)).toBe(60);
    expect(magicLinkCooldownRemaining('a@b.co', 31_000)).toBe(30);
    expect(magicLinkCooldownRemaining('a@b.co', 61_000)).toBe(0);
  });
});

describe('verifyMagicLinkToken', () => {
  const session = { access_token: 'at', refresh_token: 'rt', expires_in: 3600 };

  it('posts only the token and returns the two session tokens', async () => {
    mockInvoke.mockResolvedValue({ data: { success: true, session, user: { id: 'u1' } }, error: null });
    await expect(verifyMagicLinkToken(TOKEN)).resolves.toEqual({ access_token: 'at', refresh_token: 'rt' });
    expect(mockInvoke).toHaveBeenCalledWith('magic-link-verify', { body: { token: TOKEN } });
  });

  it('never calls the server for a malformed token', async () => {
    await expect(verifyMagicLinkToken('nope')).rejects.toMatchObject({ kind: 'invalid_link' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it.each([400, 401, 404])('maps HTTP %s to invalid_link', async (status) => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(status, { error: 'Ce lien a déjà été utilisé ou est invalide.' }) });
    const error = await verifyMagicLinkToken(TOKEN).catch((e) => e);
    expect(error.kind).toBe('invalid_link');
    expect(magicLinkErrorMessage(error)).toBe('Ce lien est invalide, expiré ou déjà utilisé. Demande-en un nouveau.');
  });

  it('maps a non-patient refusal (403) to forbidden with the server text', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(403, { error: "Ce type de connexion n'est disponible que pour les patients" }),
    });
    const error = await verifyMagicLinkToken(TOKEN).catch((e) => e);
    expect(error.kind).toBe('forbidden');
    expect(magicLinkErrorMessage(error)).toBe("Ce type de connexion n'est disponible que pour les patients");
  });

  it.each([
    { success: true },
    { success: true, session: { access_token: 'at' } },
    { success: true, session: { access_token: 1, refresh_token: 2 } },
    null,
  ])('rejects a response without a usable session: %p', async (data) => {
    mockInvoke.mockResolvedValue({ data, error: null });
    await expect(verifyMagicLinkToken(TOKEN)).rejects.toBeInstanceOf(MagicLinkError);
  });
});
