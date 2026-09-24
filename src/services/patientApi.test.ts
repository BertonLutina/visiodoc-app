import { SlotUnavailableError } from './patientApi';

describe('SlotUnavailableError', () => {
  it('carries a friendly message for an overlap conflict', () => {
    const err = new SlotUnavailableError('overlap');
    expect(err.reason).toBe('overlap');
    expect(err.message).toMatch(/créneau/i);
    expect(err).toBeInstanceOf(Error);
  });

  it('carries a friendly message for the one-per-day conflict', () => {
    const err = new SlotUnavailableError('daily-limit');
    expect(err.reason).toBe('daily-limit');
    expect(err.message).toMatch(/déjà un rendez-vous/i);
  });
});

describe('bookConsultation', () => {
  const insertMock = jest.fn();
  const singleMock = jest.fn();
  const selectMock = jest.fn();
  const fromMock = jest.fn();
  const invokeMock = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    singleMock.mockResolvedValue({ data: { id: 'consult-1' }, error: null });
    selectMock.mockReturnValue({ single: singleMock });
    insertMock.mockReturnValue({ select: selectMock });
    fromMock.mockReturnValue({ insert: insertMock });
    jest.doMock('@/lib/supabase', () => ({
      supabase: { from: fromMock, functions: { invoke: invokeMock } },
      supabasePublic: null,
      supabaseConfigured: true,
    }));
  });

  afterEach(() => {
    jest.dontMock('@/lib/supabase');
  });

  it('persists the actual appointment duration, not a hardcoded default', async () => {
    const { bookConsultation: bookConsultationFresh } = require('./patientApi');
    await bookConsultationFresh({
      patientId: 'p1',
      doctorId: 'd1',
      scheduledAt: '2026-10-15T09:00:00.000Z',
      type: 'video',
      fee: 5000,
      duration: 60,
    });
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ duration: 60 }));
  });

  it('maps a Postgres exclusion-violation (23P01) to SlotUnavailableError("overlap")', async () => {
    singleMock.mockResolvedValue({ data: null, error: { code: '23P01', message: 'exclusion' } });
    const { bookConsultation: bookConsultationFresh, SlotUnavailableError: ErrFresh } = require('./patientApi');
    await expect(
      bookConsultationFresh({
        patientId: 'p1',
        doctorId: 'd1',
        scheduledAt: '2026-10-15T09:00:00.000Z',
        type: 'video',
        fee: 5000,
        duration: 30,
      }),
    ).rejects.toThrow(ErrFresh);
  });

  it('maps the specific one_booking_per_provider_per_day unique violation to SlotUnavailableError("daily-limit")', async () => {
    singleMock.mockResolvedValue({
      data: null,
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "one_booking_per_provider_per_day"',
      },
    });
    const { bookConsultation: bookConsultationFresh } = require('./patientApi');
    await expect(
      bookConsultationFresh({
        patientId: 'p1',
        doctorId: 'd1',
        scheduledAt: '2026-10-15T09:00:00.000Z',
        type: 'video',
        fee: 5000,
        duration: 30,
      }),
    ).rejects.toMatchObject({ name: 'SlotUnavailableError', reason: 'daily-limit' });
  });

  it('does not misreport an unrelated unique-violation (23505) as the daily-limit conflict', async () => {
    singleMock.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "some_other_index"' },
    });
    const { bookConsultation: bookConsultationFresh } = require('./patientApi');
    await expect(
      bookConsultationFresh({
        patientId: 'p1',
        doctorId: 'd1',
        scheduledAt: '2026-10-15T09:00:00.000Z',
        type: 'video',
        fee: 5000,
        duration: 30,
      }),
    ).rejects.toMatchObject({ code: '23505', message: expect.stringContaining('some_other_index') });
  });
});
