describe('avatar helpers', () => {
  const { avatarExtension, avatarPath, avatarPathFromUrl } = require('./avatar');

  it('maps MIME types to extensions, defaulting to jpg', () => {
    expect(avatarExtension('image/png')).toBe('png');
    expect(avatarExtension('image/webp')).toBe('webp');
    expect(avatarExtension('image/heic')).toBe('jpg');
  });

  it('builds a {userId}/avatar-{ts}.{ext} path', () => {
    expect(avatarPath('u-1', 'image/png', 123)).toBe('u-1/avatar-123.png');
  });

  it('extracts the storage path from a public URL, and ignores foreign URLs', () => {
    const url = 'https://x.supabase.co/storage/v1/object/public/avatars/u-1/avatar-123.jpg?t=1';
    expect(avatarPathFromUrl(url)).toBe('u-1/avatar-123.jpg');
    expect(avatarPathFromUrl('file:///tmp/photo.jpg')).toBeNull();
    expect(avatarPathFromUrl(undefined)).toBeNull();
  });
});

describe('uploadAvatar', () => {
  beforeEach(() => {
    jest.resetModules();
    globalThis.fetch = jest.fn().mockResolvedValue({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }) as any;
  });
  afterEach(() => {
    jest.dontMock('@/lib/supabase');
  });

  it('uploads to the avatars bucket under the user folder and returns the public URL', async () => {
    const uploadMock = jest.fn().mockResolvedValue({ error: null });
    const getPublicUrl = jest.fn((p: string) => ({ data: { publicUrl: `https://cdn/${p}` } }));
    const from = jest.fn(() => ({ upload: uploadMock, getPublicUrl }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { storage: { from } }, supabaseConfigured: true }));
    const { uploadAvatar } = require('./avatar');

    const url = await uploadAvatar('u-1', { uri: 'file://a.jpg', mimeType: 'image/jpeg' });

    expect(from).toHaveBeenCalledWith('avatars');
    const [path, body, opts] = uploadMock.mock.calls[0];
    expect(body).toBeInstanceOf(ArrayBuffer);
    expect(opts).toEqual({ contentType: 'image/jpeg' });
    expect(path.startsWith('u-1/avatar-')).toBe(true);
    expect(url).toBe(`https://cdn/${path}`);
  });

  it('propagates a Storage error', async () => {
    const uploadMock = jest.fn().mockResolvedValue({ error: { message: 'RLS violation' } });
    const from = jest.fn(() => ({ upload: uploadMock }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { storage: { from } }, supabaseConfigured: true }));
    const { uploadAvatar } = require('./avatar');
    await expect(uploadAvatar('u-1', { uri: 'file://a.jpg', mimeType: 'image/jpeg' })).rejects.toMatchObject({
      message: 'RLS violation',
    });
  });

  it('returns the local URI in demo mode (no Supabase)', async () => {
    jest.doMock('@/lib/supabase', () => ({ supabase: null, supabaseConfigured: false }));
    const { uploadAvatar } = require('./avatar');
    await expect(uploadAvatar('u-1', { uri: 'file://a.jpg', mimeType: 'image/jpeg' })).resolves.toBe('file://a.jpg');
  });
});
