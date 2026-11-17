import {
  AvatarError,
  avatarErrorCode,
  avatarErrorMessage,
  incomingAvatarPath,
  removeAvatar,
  signedAvatarUrl,
  targetSize,
  uploadAvatar,
  uuidV4,
} from './avatar';
import { setCurrentLangCode } from '@/i18n/core';

// `expo-image-manipulator` est une dépendance ajoutée avec ce lot : simulée (virtuelle) pour les tests.
const mockSaveAsync = jest.fn();
const mockRenderAsync = jest.fn();
const mockResize = jest.fn();
const mockManipulate = jest.fn();
jest.mock(
  'expo-image-manipulator',
  () => ({
    ImageManipulator: { manipulate: (...a: unknown[]) => mockManipulate(...a) },
    SaveFormat: { JPEG: 'jpeg' },
  }),
  { virtual: true },
);

const mockUpload = jest.fn();
const mockCreateSignedUrl = jest.fn();
const mockStorageFrom = jest.fn();
const mockInvoke = jest.fn();
const mockTableFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabaseConfigured: true,
  supabase: {
    storage: { from: (...a: unknown[]) => mockStorageFrom(...a) },
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    from: (...a: unknown[]) => mockTableFrom(...a),
    rpc: (...a: unknown[]) => mockRpc(...a),
  },
}));

const USER_ID = '8A1B2C3D-0000-4000-8000-00000000CD01';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const httpError = (status: number, body: unknown) => ({
  name: 'FunctionsHttpError',
  message: 'Edge Function returned a non-2xx status code',
  context: new Response(JSON.stringify(body), { status }),
});

const bytes = (n: number) => new ArrayBuffer(n);

beforeEach(() => {
  setCurrentLangCode('fr');
  [mockSaveAsync, mockRenderAsync, mockResize, mockManipulate, mockUpload, mockCreateSignedUrl, mockStorageFrom, mockInvoke, mockTableFrom, mockRpc].forEach(
    (m) => m.mockReset(),
  );
  mockSaveAsync.mockResolvedValue({ uri: 'file://out.jpg', width: 1024, height: 1024 });
  mockRenderAsync.mockResolvedValue({ saveAsync: mockSaveAsync });
  mockManipulate.mockReturnValue({ resize: mockResize, renderAsync: mockRenderAsync });
  mockStorageFrom.mockReturnValue({ upload: mockUpload, createSignedUrl: mockCreateSignedUrl });
  mockUpload.mockResolvedValue({ error: null });
  mockInvoke.mockResolvedValue({ data: { ok: true, path: `${USER_ID.toLowerCase()}/validated/abc.jpg` }, error: null });
  globalThis.fetch = jest.fn().mockResolvedValue({ arrayBuffer: () => Promise.resolve(bytes(1000)) }) as any;
});

describe('incomingAvatarPath', () => {
  it('is <lowercase id>/incoming/<uuid v4>.jpg', () => {
    const path = incomingAvatarPath(USER_ID);
    const [folder, incoming, file] = path.split('/');
    expect(folder).toBe(USER_ID.toLowerCase());
    expect(incoming).toBe('incoming');
    expect(file).toMatch(new RegExp(`${UUID_V4.source.slice(1, -1)}\\.jpg$`));
  });

  it('uses a new uuid every time and a valid v4 format', () => {
    expect(uuidV4()).toMatch(UUID_V4);
    expect(incomingAvatarPath(USER_ID)).not.toBe(incomingAvatarPath(USER_ID));
  });
});

describe('targetSize', () => {
  it('keeps an image already within 1024 and shrinks the others without distortion', () => {
    expect(targetSize(800, 600)).toBeNull();
    expect(targetSize(1024, 1024)).toBeNull();
    expect(targetSize(4000, 2000)).toEqual({ width: 1024, height: 512 });
    expect(targetSize(3000, 3000)).toEqual({ width: 1024, height: 1024 });
    expect(targetSize(undefined, undefined)).toBeNull();
  });
});

describe('uploadAvatar (MOB-1611-2)', () => {
  it('converts to JPEG, uploads to avatars-private without upsert, then calls finalize-avatar with the path', async () => {
    const result = await uploadAvatar(USER_ID, { uri: 'file://in.heic', width: 4000, height: 3000 });

    expect(mockResize).toHaveBeenCalledWith({ width: 1024, height: 768 });
    expect(mockSaveAsync).toHaveBeenCalledWith(expect.objectContaining({ format: 'jpeg' }));
    expect(mockStorageFrom).toHaveBeenCalledWith('avatars-private');
    const [path, body, opts] = mockUpload.mock.calls[0];
    expect(path).toMatch(new RegExp(`^${USER_ID.toLowerCase()}/incoming/[0-9a-f-]{36}\\.jpg$`));
    expect(body).toBeInstanceOf(ArrayBuffer);
    expect(opts).toEqual({ contentType: 'image/jpeg', upsert: false });
    expect(mockInvoke).toHaveBeenCalledWith('finalize-avatar', { body: { path } });
    expect(result).toBe(`${USER_ID.toLowerCase()}/validated/abc.jpg`);
  });

  it('never writes avatar_url nor any users column, and never calls the set_my_avatar RPC', async () => {
    await uploadAvatar(USER_ID, { uri: 'file://in.jpg', width: 500, height: 500 });
    expect(mockTableFrom).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockResize).not.toHaveBeenCalled();
  });

  it('retries with a lower quality when the JPEG is over 2 MB, and gives up with too_large', async () => {
    const big = bytes(2 * 1024 * 1024 + 1);
    (globalThis.fetch as jest.Mock)
      .mockResolvedValueOnce({ arrayBuffer: () => Promise.resolve(big) })
      .mockResolvedValueOnce({ arrayBuffer: () => Promise.resolve(bytes(500)) });
    await uploadAvatar(USER_ID, { uri: 'file://in.jpg' });
    expect(mockSaveAsync).toHaveBeenCalledTimes(2);
    expect(mockSaveAsync.mock.calls[1][0].compress).toBeLessThan(mockSaveAsync.mock.calls[0][0].compress);

    mockSaveAsync.mockClear();
    mockUpload.mockClear();
    (globalThis.fetch as jest.Mock).mockResolvedValue({ arrayBuffer: () => Promise.resolve(big) });
    await expect(uploadAvatar(USER_ID, { uri: 'file://in.jpg' })).rejects.toMatchObject({ code: 'too_large' });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid_image', 400],
    ['too_large', 400],
    ['too_big_dimensions', 400],
  ])('maps the server code %s (HTTP %i)', async (code, status) => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(status, { ok: false, code }) });
    await expect(uploadAvatar(USER_ID, { uri: 'file://in.jpg' })).rejects.toMatchObject({ code });
  });

  it('maps HTTP 429 to rate_limited', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(429, { ok: false, code: 'rate_limited' }) });
    const err = await uploadAvatar(USER_ID, { uri: 'file://in.jpg' }).catch((e) => e);
    expect(err).toBeInstanceOf(AvatarError);
    expect(err.code).toBe('rate_limited');
  });

  it('maps an unknown refusal to unknown (never a raw server text)', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(400, { ok: false, code: 'weird', error: 'secret detail' }) });
    const err = await uploadAvatar(USER_ID, { uri: 'file://in.jpg' }).catch((e) => e);
    expect(err.code).toBe('unknown');
    expect(avatarErrorMessage(err)).not.toContain('secret detail');
  });

  it('propagates a Storage refusal without calling finalize-avatar', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'policy violation' } });
    await expect(uploadAvatar(USER_ID, { uri: 'file://in.jpg' })).rejects.toMatchObject({ message: 'policy violation' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe('removeAvatar', () => {
  it("calls finalize-avatar with { action: 'remove' } and nothing else", async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });
    await removeAvatar();
    expect(mockInvoke).toHaveBeenCalledWith('finalize-avatar', { body: { action: 'remove' } });
    expect(mockTableFrom).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockStorageFrom).not.toHaveBeenCalled();
  });
});

describe('signedAvatarUrl', () => {
  it('signs a validated path on avatars-private', async () => {
    mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed/x' }, error: null });
    await expect(signedAvatarUrl('u/validated/a.jpg')).resolves.toBe('https://signed/x');
    expect(mockStorageFrom).toHaveBeenCalledWith('avatars-private');
    expect(mockCreateSignedUrl).toHaveBeenCalledWith('u/validated/a.jpg', 3600);
  });

  it('returns null without a path or when signing fails', async () => {
    await expect(signedAvatarUrl(null)).resolves.toBeNull();
    mockCreateSignedUrl.mockResolvedValue({ data: null, error: { message: 'denied' } });
    await expect(signedAvatarUrl('u/validated/a.jpg')).resolves.toBeNull();
  });
});

describe('no client write on protected avatar columns (MOB-1611-2)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('path');

  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of fs.readdirSync(dir) as string[]) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
    }
    return out;
  };

  it('no source file assigns avatar_url, avatar_path or avatar_pending_path (only reads them)', () => {
    const root = path.resolve(process.cwd());
    const files = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'src'))];
    const writes = /(?:patch|payload|update\([^)]*)\.?\s*avatar_(?:url|path|pending_path|review_\w+)\s*(?:=[^=]|:)|set_my_avatar|remove_my_avatar/;
    const offenders = files.filter((f) => writes.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('avatarErrorMessage / avatarErrorCode', () => {
  it('recognises the four documented codes only', () => {
    expect(avatarErrorCode('invalid_image')).toBe('invalid_image');
    expect(avatarErrorCode('rate_limited')).toBe('rate_limited');
    expect(avatarErrorCode('nope')).toBe('unknown');
    expect(avatarErrorCode(undefined)).toBe('unknown');
  });

  it('gives a distinct, translated message per code', () => {
    const codes = ['invalid_image', 'too_large', 'too_big_dimensions', 'rate_limited'] as const;
    const fr = codes.map((c) => avatarErrorMessage(new AvatarError(c)));
    expect(new Set(fr).size).toBe(4);
    setCurrentLangCode('en');
    codes.forEach((c, i) => expect(avatarErrorMessage(new AvatarError(c))).not.toBe(fr[i]));
  });
});
