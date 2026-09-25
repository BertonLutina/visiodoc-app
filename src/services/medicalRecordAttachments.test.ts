describe('uploadRecordAttachment', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({ blob: () => Promise.resolve('fake-blob') });
  });
  afterEach(() => {
    jest.dontMock('@/lib/supabase');
  });

  it('uploads to the {patientId}/{recordId}/... path in the medical-record-attachments bucket', async () => {
    const uploadMock = jest.fn().mockResolvedValue({ error: null });
    const fromStorageMock = jest.fn(() => ({ upload: uploadMock }));
    jest.doMock('@/lib/supabase', () => ({
      supabase: { storage: { from: fromStorageMock } },
      supabaseConfigured: true,
    }));

    const { uploadRecordAttachment: uploadFresh } = require('./medicalRecordAttachments');
    const result = await uploadFresh('pat-1', 'rec-1', { uri: 'file://x.jpg', name: 'photo.jpg', mimeType: 'image/jpeg' });

    expect(fromStorageMock).toHaveBeenCalledWith('medical-record-attachments');
    expect(uploadMock).toHaveBeenCalled();
    const [path] = uploadMock.mock.calls[0];
    expect(path.startsWith('pat-1/rec-1/')).toBe(true);
    expect(result.name).toBe('photo.jpg');
    expect(result.path).toBe(path);
  });

  it('propagates a Storage upload error instead of swallowing it', async () => {
    const uploadMock = jest.fn().mockResolvedValue({ error: { message: 'RLS violation' } });
    const fromStorageMock = jest.fn(() => ({ upload: uploadMock }));
    jest.doMock('@/lib/supabase', () => ({
      supabase: { storage: { from: fromStorageMock } },
      supabaseConfigured: true,
    }));

    const { uploadRecordAttachment: uploadFresh } = require('./medicalRecordAttachments');
    await expect(
      uploadFresh('pat-1', 'rec-1', { uri: 'file://x.jpg', name: 'photo.jpg', mimeType: 'image/jpeg' }),
    ).rejects.toMatchObject({ message: 'RLS violation' });
  });

  it('returns a placeholder without throwing when Supabase is not configured (demo mode)', async () => {
    jest.doMock('@/lib/supabase', () => ({ supabase: null, supabaseConfigured: false }));
    const { uploadRecordAttachment: uploadFresh } = require('./medicalRecordAttachments');
    const result = await uploadFresh('pat-1', 'rec-1', { uri: 'file://x.jpg', name: 'photo.jpg', mimeType: 'image/jpeg' });
    expect(result.name).toBe('photo.jpg');
    expect(result.path).toBe('');
  });
});
