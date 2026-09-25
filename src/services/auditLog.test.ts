import { logMedicalRecordEvent } from './auditLog';

describe('logMedicalRecordEvent', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.dontMock('@/lib/supabase');
  });

  it('inserts an audit_logs row with the record id and type in the payload', async () => {
    const insertMock = jest.fn().mockResolvedValue({ error: null });
    const fromMock = jest.fn(() => ({ insert: insertMock }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: fromMock } }));

    const { logMedicalRecordEvent: logFresh } = require('./auditLog');
    await logFresh('medical_record:create', 'doc-1', 'pat-1', 'rec-1', 'prescription');

    expect(fromMock).toHaveBeenCalledWith('audit_logs');
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_id: 'doc-1',
        actor_role: 'provider',
        action: 'medical_record:create',
        target_id: 'pat-1',
        payload: { record_id: 'rec-1', record_type: 'prescription' },
      }),
    );
  });

  it('never throws when the insert fails (best-effort)', async () => {
    const insertMock = jest.fn().mockRejectedValue(new Error('offline'));
    const fromMock = jest.fn(() => ({ insert: insertMock }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: fromMock } }));

    const { logMedicalRecordEvent: logFresh } = require('./auditLog');
    await expect(logFresh('medical_record:archive', 'doc-1', 'pat-1', 'rec-1', 'note')).resolves.toBeUndefined();
  });
});
