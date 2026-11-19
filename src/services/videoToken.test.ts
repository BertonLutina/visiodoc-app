import {
  buildRoomUrl,
  buildRoomWebViewUrl,
  isAllowedRoomNavigation,
  fetchVideoToken,
  isHttpsServerUrl,
  videoFailure,
  videoJoinBody,
  videoRoomId,
} from './videoToken';
import { onSessionExpired } from './sessionExpiry';

// Seule frontière simulée : `@/lib/supabase` (Edge Function `get-video-token` + rafraîchissement de session).
const mockInvoke = jest.fn();
const mockRefresh = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabaseConfigured: true,
  supabase: {
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    auth: { refreshSession: (...a: unknown[]) => mockRefresh(...a) },
  },
  supabasePublic: null,
}));

/** Erreur telle que la renvoie supabase-js : FunctionsHttpError avec la `Response` dans `context`. */
const httpError = (status: number, body: unknown) => ({
  name: 'FunctionsHttpError',
  message: 'Edge Function returned a non-2xx status code',
  context: new Response(JSON.stringify(body), { status }),
});

const ROOM_ID = 'f3b1e2c4-0000-0000-0000-000000000000';
// Exemple du guide (réponse 200 JaaS).
const OK_PAYLOAD = {
  success: true,
  data: {
    provider: 'jitsi',
    mode: 'jaas',
    serverUrl: 'https://8x8.vc',
    roomName: 'vpaas-magic-cookie-xxx/TeleMedecine_f3b1e2c4-0000-0000-0000-000000000000',
    jwt: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb29tIjoiKiJ9.c2ln',
  },
};

// 09:05 à l'heure LOCALE de l'appareil, quel que soit le fuseau de la machine de test.
const LOCAL_0905 = new Date(2026, 10, 8, 9, 5).toISOString();
const LOCAL_2307 = new Date(2026, 10, 8, 23, 7).toISOString();
const LOCAL_MIDNIGHT = new Date(2026, 10, 9, 0, 0).toISOString();

beforeEach(() => {
  jest.clearAllMocks();
  mockRefresh.mockResolvedValue({ data: {}, error: null });
});

describe('videoRoomId', () => {
  it('prefers video_room_id', () => {
    expect(videoRoomId({ id: 'c1', video_room_id: 'room-1' })).toBe('room-1');
  });

  it.each([undefined, null, ''])('falls back to the consultation id when video_room_id is %p', (empty) => {
    expect(videoRoomId({ id: 'c1', video_room_id: empty as string | null | undefined })).toBe('c1');
  });

  it('falls back to the consultation id when video_room_id is absent', () => {
    expect(videoRoomId({ id: 'c1' })).toBe('c1');
  });
});

describe('videoJoinBody', () => {
  it('is exactly { roomId } — identity is built by the server', () => {
    const body = videoJoinBody(ROOM_ID);
    expect(body).toEqual({ roomId: ROOM_ID });
    expect(Object.keys(body)).toHaveLength(1);
    for (const forbidden of ['userName', 'userEmail', 'userPhone', 'userId', 'role']) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });
});

describe('videoFailure', () => {
  it('maps 403 room_not_open_yet to the guide message with the local HH:MM of opensAt', () => {
    expect(videoFailure(403, { code: 'room_not_open_yet', opensAt: LOCAL_0905 })).toEqual({
      kind: 'too_early',
      message: "La consultation n'est pas encore ouverte (la salle ouvre à 09:05)",
      opensAt: LOCAL_0905,
    });
  });

  it('zero-pads the hours and minutes and uses a 24h clock', () => {
    expect(videoFailure(403, { code: 'room_not_open_yet', opensAt: LOCAL_2307 }).message).toBe(
      "La consultation n'est pas encore ouverte (la salle ouvre à 23:07)",
    );
    expect(videoFailure(403, { code: 'room_not_open_yet', opensAt: LOCAL_MIDNIGHT }).message).toBe(
      "La consultation n'est pas encore ouverte (la salle ouvre à 00:00)",
    );
  });

  it('formats the guide example (2026-11-08T13:45:00.000Z) in the device local time', () => {
    const d = new Date('2026-11-08T13:45:00.000Z');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    expect(videoFailure(403, { code: 'room_not_open_yet', opensAt: '2026-11-08T13:45:00.000Z' }).message).toBe(
      `La consultation n'est pas encore ouverte (la salle ouvre à ${hh}:${mm})`,
    );
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
    ['invalid', 'pas-une-date'],
  ])('omits the parenthesis and opensAt when opensAt is %s', (_name, opensAt) => {
    expect(videoFailure(403, { code: 'room_not_open_yet', opensAt: opensAt as string | null | undefined })).toEqual({
      kind: 'too_early',
      message: "La consultation n'est pas encore ouverte",
      opensAt: null,
    });
  });

  it('maps 403 room_closed', () => {
    expect(videoFailure(403, { code: 'room_closed', opensAt: null })).toEqual({
      kind: 'closed',
      message: 'La salle de cette consultation est fermée',
      opensAt: null,
    });
  });

  it('maps 403 consultation_cancelled', () => {
    expect(videoFailure(403, { code: 'consultation_cancelled', opensAt: null })).toEqual({
      kind: 'cancelled',
      message: 'Cette consultation est annulée ou manquée',
      opensAt: null,
    });
  });

  it('maps 403 provider_start_window_over (médecin absent après 15 min) with a clear message, no technical error', () => {
    expect(videoFailure(403, { code: 'provider_start_window_over', error: 'x' })).toEqual({
      kind: 'start_window_over',
      message:
        "Le délai de 15 minutes pour lancer l'appel est dépassé : la consultation est annulée (médecin absent) et le patient est remboursé en avoir.",
      opensAt: null,
    });
  });

  it('maps any other 403 (no code or unknown code) to denied', () => {
    const denied = { kind: 'denied', message: 'Accès à cette salle refusé', opensAt: null };
    expect(videoFailure(403, { error: 'Accès à cette salle refusé' })).toEqual(denied);
    expect(videoFailure(403, {})).toEqual(denied);
    expect(videoFailure(403, { code: 'autre_code' })).toEqual(denied);
  });

  it('maps 401 to unauthenticated with the session-expired message', () => {
    expect(videoFailure(401, { error: 'Non authentifié' })).toEqual({
      kind: 'unauthenticated',
      message: 'Ta session a expiré, reconnecte-toi.',
      opensAt: null,
    });
  });

  it('does not let a room code override a 401', () => {
    expect(videoFailure(401, { code: 'room_closed' }).kind).toBe('unauthenticated');
  });

  it('tolerates a missing body', () => {
    expect(videoFailure(403, undefined as never).kind).toBe('denied');
  });
});

describe('buildRoomUrl', () => {
  it('builds exactly `${serverUrl}/${roomName}?jwt=${jwt}` (the roomName keeps its slash)', () => {
    expect(buildRoomUrl(OK_PAYLOAD.data)).toBe(
      'https://8x8.vc/vpaas-magic-cookie-xxx/TeleMedecine_f3b1e2c4-0000-0000-0000-000000000000?jwt=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb29tIjoiKiJ9.c2ln',
    );
  });

  it('does not double the slash when serverUrl ends with one', () => {
    expect(buildRoomUrl({ serverUrl: 'https://8x8.vc/', roomName: 'app/room', jwt: 'a.b.c' })).toBe(
      'https://8x8.vc/app/room?jwt=a.b.c',
    );
    expect(buildRoomUrl({ serverUrl: 'https://8x8.vc//', roomName: '/app/room', jwt: 'a.b.c' })).toBe(
      'https://8x8.vc/app/room?jwt=a.b.c',
    );
  });

  it('leaves a real JWT untouched (base64url + dots are URL-safe) but encodes unsafe characters', () => {
    expect(buildRoomUrl({ serverUrl: 'https://8x8.vc', roomName: 'r', jwt: 'A-b_9.C-d_8.E' })).toBe(
      'https://8x8.vc/r?jwt=A-b_9.C-d_8.E',
    );
    expect(buildRoomUrl({ serverUrl: 'https://8x8.vc', roomName: 'r', jwt: 'a+b/c=&d' })).toBe(
      'https://8x8.vc/r?jwt=a%2Bb%2Fc%3D%26d',
    );
  });

  it('never enables recording through the URL', () => {
    expect(buildRoomUrl(OK_PAYLOAD.data)).not.toMatch(/record/i);
  });
});

describe('buildRoomWebViewUrl', () => {
  it('is the contract URL plus a client-side fragment that skips the "open in the app" page', () => {
    const url = buildRoomWebViewUrl(OK_PAYLOAD.data);
    expect(url).toBe(
      `${buildRoomUrl(OK_PAYLOAD.data)}#config.disableDeepLinking=true&config.prejoinConfig.enabled=false&config.prejoinPageEnabled=false`,
    );
    // le fragment n'est jamais envoyé au serveur : la requête reste `${serverUrl}/${roomName}?jwt=${jwt}`
    expect(url.split('#')[0]).toBe(buildRoomUrl(OK_PAYLOAD.data));
    expect(url).not.toMatch(/record/i);
  });
});

describe('buildRoomWebViewUrl with a display name', () => {
  it('passes the known name (JSON then URI encoded) so Jitsi does not ask for it', () => {
    const url = buildRoomWebViewUrl(OK_PAYLOAD.data, ' Chris Mongongu ');
    expect(url.endsWith('&userInfo.displayName=%22Chris%20Mongongu%22')).toBe(true);
    expect(url.split('#')[0]).toBe(buildRoomUrl(OK_PAYLOAD.data));
  });
  it('omits the name when empty', () => {
    expect(buildRoomWebViewUrl(OK_PAYLOAD.data, '  ')).not.toMatch(/displayName/);
  });
});

describe('isAllowedRoomNavigation', () => {
  const server = 'https://8x8.vc';
  it('allows pages of the video server (and about:blank)', () => {
    expect(isAllowedRoomNavigation('https://8x8.vc/vpaas-magic-cookie-xxx/Room?jwt=a.b.c', server, true)).toBe(true);
    expect(isAllowedRoomNavigation('https://8x8.vc/static/close.html', 'https://8x8.vc/', true)).toBe(true);
    expect(isAllowedRoomNavigation('about:blank', server, true)).toBe(true);
  });

  it('blocks other hosts, look-alike hosts, http and other schemes for the top frame', () => {
    for (const url of [
      'https://evil.example/phish',
      'https://8x8.vc.evil.example/x',
      'https://evil.example/https://8x8.vc/',
      'http://8x8.vc/room',
      'intent://scan/#Intent;scheme=zxing;end',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'visiodoc://payment/callback',
    ]) {
      expect(isAllowedRoomNavigation(url, server, true)).toBe(false);
    }
  });

  it("allows the top frame on the serverUrl host, whatever it is", () => {
    const own = 'https://meet.example.com/';
    expect(isAllowedRoomNavigation('https://meet.example.com/room?jwt=a', own, true)).toBe(true);
    expect(isAllowedRoomNavigation('https://other.example.com/room', own, true)).toBe(false);
  });

  it('additionally allows the 8x8 hosts (8x8.vc, *.8x8.vc, jaas.8x8.vc) for the top frame', () => {
    const own = 'https://meet.example.com';
    for (const url of [
      'https://8x8.vc/room',
      'https://jaas.8x8.vc/vpaas-magic-cookie-x/Room',
      'https://meet.8x8.vc/x',
      'https://JAAS.8X8.VC/x',
    ]) {
      expect(isAllowedRoomNavigation(url, own, true)).toBe(true);
    }
  });

  it('blocks look-alikes of the 8x8 hosts and http for the top frame', () => {
    const own = 'https://meet.example.com';
    for (const url of [
      'http://8x8.vc/room',
      'http://jaas.8x8.vc/room',
      'https://evil8x8.vc/x',
      'https://8x8.vc.evil.example/x',
      'https://jaas.8x8.vc.evil.example/x',
      'https://evil.example/?u=https://8x8.vc/',
      'https://user@evil.example/8x8.vc',
    ]) {
      expect(isAllowedRoomNavigation(url, own, true)).toBe(false);
    }
  });

  it('lets embedded frames load other https origins but never http', () => {
    expect(isAllowedRoomNavigation('https://cdn.example/frame', server, false)).toBe(true);
    expect(isAllowedRoomNavigation('http://cdn.example/frame', server, false)).toBe(false);
  });
});

describe('isHttpsServerUrl', () => {
  it.each([
    ['https://8x8.vc', true],
    ['https://8x8.vc/', true],
    ['http://8x8.vc', false],
    ['http://meet.jit.si', false],
    ['javascript:alert(1)', false],
    ['8x8.vc', false],
    ['', false],
    [undefined, false],
  ])('%p → %p', (url, expected) => {
    expect(isHttpsServerUrl(url as string | undefined)).toBe(expected);
  });
});

describe('fetchVideoToken', () => {
  it("invokes get-video-token with exactly { body: { roomId } }", async () => {
    mockInvoke.mockResolvedValue({ data: OK_PAYLOAD, error: null });
    await fetchVideoToken(ROOM_ID);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke.mock.calls[0]).toEqual(['get-video-token', { body: { roomId: ROOM_ID } }]);
  });

  it('returns serverUrl, roomName and jwt from the guide success payload (data.data)', async () => {
    mockInvoke.mockResolvedValue({ data: OK_PAYLOAD, error: null });
    expect(await fetchVideoToken(ROOM_ID)).toEqual({
      ok: true,
      session: {
        serverUrl: 'https://8x8.vc',
        roomName: OK_PAYLOAD.data.roomName,
        jwt: OK_PAYLOAD.data.jwt,
      },
    });
  });

  it('also accepts the fields at the top level of the body', async () => {
    mockInvoke.mockResolvedValue({ data: OK_PAYLOAD.data, error: null });
    const result = await fetchVideoToken(ROOM_ID);
    expect(result).toEqual({ ok: true, session: { serverUrl: 'https://8x8.vc', roomName: OK_PAYLOAD.data.roomName, jwt: OK_PAYLOAD.data.jwt } });
  });

  it('maps a 403 room_not_open_yet FunctionsHttpError to too_early', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(403, { success: false, code: 'room_not_open_yet', opensAt: LOCAL_0905, error: 'x' }),
    });
    expect(await fetchVideoToken(ROOM_ID)).toEqual({
      ok: false,
      failure: {
        kind: 'too_early',
        message: "La consultation n'est pas encore ouverte (la salle ouvre à 09:05)",
        opensAt: LOCAL_0905,
      },
    });
  });

  it('maps 403 room_closed, consultation_cancelled and an uncoded 403', async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: httpError(403, { success: false, code: 'room_closed', opensAt: null, error: 'x' }) });
    expect(await fetchVideoToken(ROOM_ID)).toEqual({
      ok: false,
      failure: { kind: 'closed', message: 'La salle de cette consultation est fermée', opensAt: null },
    });
    mockInvoke.mockResolvedValueOnce({ data: null, error: httpError(403, { success: false, code: 'consultation_cancelled', opensAt: null, error: 'x' }) });
    expect(await fetchVideoToken(ROOM_ID)).toEqual({
      ok: false,
      failure: { kind: 'cancelled', message: 'Cette consultation est annulée ou manquée', opensAt: null },
    });
    mockInvoke.mockResolvedValueOnce({ data: null, error: httpError(403, { success: false, error: 'Accès à cette salle refusé' }) });
    expect(await fetchVideoToken(ROOM_ID)).toEqual({
      ok: false,
      failure: { kind: 'denied', message: 'Accès à cette salle refusé', opensAt: null },
    });
  });

  describe('401', () => {
    it('refreshes the session once, retries once with the same body, and returns the token', async () => {
      mockInvoke
        .mockResolvedValueOnce({ data: null, error: httpError(401, { success: false, error: 'Non authentifié' }) })
        .mockResolvedValueOnce({ data: OK_PAYLOAD, error: null });
      const result = await fetchVideoToken(ROOM_ID);
      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(mockInvoke).toHaveBeenCalledTimes(2);
      expect(mockInvoke.mock.calls[1]).toEqual(['get-video-token', { body: { roomId: ROOM_ID } }]);
      expect(result.ok).toBe(true);
    });

    it('reports a session expiry (login with the expired-session message) when the refresh fails', async () => {
      const expired = jest.fn();
      const off = onSessionExpired(expired);
      mockInvoke.mockResolvedValue({ data: null, error: httpError(401, { success: false, error: 'Non authentifié' }) });
      mockRefresh.mockResolvedValue({ data: {}, error: { code: 'refresh_token_not_found', message: 'Invalid Refresh Token' } });
      const result = await fetchVideoToken(ROOM_ID);
      off();
      expect(mockInvoke).toHaveBeenCalledTimes(1);
      expect(expired).toHaveBeenCalled();
      expect(result).toEqual({
        ok: false,
        failure: { kind: 'unauthenticated', message: 'Ta session a expiré, reconnecte-toi.', opensAt: null },
      });
    });

    it('reports a session expiry when the retry is still refused with 401', async () => {
      const expired = jest.fn();
      const off = onSessionExpired(expired);
      mockInvoke.mockResolvedValue({ data: null, error: httpError(401, { success: false, error: 'Non authentifié' }) });
      const result = await fetchVideoToken(ROOM_ID);
      off();
      expect(mockInvoke).toHaveBeenCalledTimes(2);
      expect(expired).toHaveBeenCalled();
      expect(result).toMatchObject({ ok: false, failure: { kind: 'unauthenticated' } });
    });
  });

  it('does not report a session expiry for a 403', async () => {
    const expired = jest.fn();
    const off = onSessionExpired(expired);
    mockInvoke.mockResolvedValue({ data: null, error: httpError(403, { success: false, code: 'room_closed' }) });
    await fetchVideoToken(ROOM_ID);
    off();
    expect(expired).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  describe('transient failures (retryable, not a refusal)', () => {
    const UNAVAILABLE = {
      ok: false,
      failure: { kind: 'unavailable', message: 'Impossible de joindre la salle. Vérifie ta connexion et réessaie.', opensAt: null },
    };

    it('network error (no HTTP response)', async () => {
      mockInvoke.mockResolvedValue({ data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send a request' } });
      expect(await fetchVideoToken(ROOM_ID)).toEqual(UNAVAILABLE);
    });

    it('invoke rejecting', async () => {
      mockInvoke.mockRejectedValue(new Error('offline'));
      expect(await fetchVideoToken(ROOM_ID)).toEqual(UNAVAILABLE);
    });

    it('5xx', async () => {
      mockInvoke.mockResolvedValue({ data: null, error: httpError(503, { error: 'boom' }) });
      expect(await fetchVideoToken(ROOM_ID)).toEqual(UNAVAILABLE);
    });

    it('200 without a usable serverUrl / roomName / jwt, or with a non-https serverUrl', async () => {
      mockInvoke.mockResolvedValueOnce({ data: { success: true, data: { serverUrl: 'https://8x8.vc', roomName: 'r' } }, error: null });
      expect(await fetchVideoToken(ROOM_ID)).toEqual(UNAVAILABLE);
      mockInvoke.mockResolvedValueOnce({ data: { success: true, data: { serverUrl: 'http://8x8.vc', roomName: 'r', jwt: 'a.b.c' } }, error: null });
      expect(await fetchVideoToken(ROOM_ID)).toEqual(UNAVAILABLE);
      mockInvoke.mockResolvedValueOnce({ data: null, error: null });
      expect(await fetchVideoToken(ROOM_ID)).toEqual(UNAVAILABLE);
    });

    it('never puts the jwt in a failure message', async () => {
      mockInvoke.mockResolvedValue({ data: { success: true, data: { ...OK_PAYLOAD.data, serverUrl: 'http://8x8.vc' } }, error: null });
      const result = await fetchVideoToken(ROOM_ID);
      expect(JSON.stringify(result)).not.toContain(OK_PAYLOAD.data.jwt);
    });
  });
});
