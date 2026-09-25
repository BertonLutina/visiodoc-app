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

import { mapMedicalRecordRow } from './patientApi';

describe('mapMedicalRecordRow', () => {
  it('maps a full row to the app MedicalRecord shape', () => {
    const row = {
      id: 'r1',
      patient_id: 'p1',
      doctor_id: 'd1',
      consultation_id: 'c1',
      record_type: 'prescription',
      title: 'Amoxicilline',
      description: 'Antibiotique',
      category: 'Infection',
      severity: 'mild',
      status: 'active',
      date_recorded: '2026-06-10T00:00:00.000Z',
      start_date: '2026-06-10T00:00:00.000Z',
      end_date: '2026-06-17T00:00:00.000Z',
      attachments: [{ name: 'ordo.pdf', path: 'p1/r1/ordo.pdf', type: 'application/pdf', uploadedAt: '2026-06-10T00:00:00.000Z' }],
      metadata: { medication_name: 'Amoxicilline', dosage: '500mg', frequency: '3x/jour' },
      created_at: '2026-06-10T00:00:00.000Z',
    };
    expect(mapMedicalRecordRow(row)).toEqual({
      id: 'r1',
      patientId: 'p1',
      doctorId: 'd1',
      consultationId: 'c1',
      kind: 'prescription',
      title: 'Amoxicilline',
      description: 'Antibiotique',
      category: 'Infection',
      severity: 'mild',
      status: 'active',
      author: '',
      date: new Date('2026-06-10T00:00:00.000Z').toLocaleDateString('fr-FR'),
      startDate: '2026-06-10T00:00:00.000Z',
      endDate: '2026-06-17T00:00:00.000Z',
      attachments: row.attachments,
      metadata: row.metadata,
    });
  });

  it('falls back to "note" for an unrecognized record_type instead of crashing', () => {
    const row = { id: 'r2', patient_id: 'p1', doctor_id: 'd1', record_type: 'something_new', title: 'X', created_at: '2026-01-01T00:00:00.000Z' };
    expect(mapMedicalRecordRow(row).kind).toBe('note');
  });

  it('defaults attachments/metadata to empty when the DB returns null', () => {
    const row = { id: 'r3', patient_id: 'p1', doctor_id: 'd1', record_type: 'note', title: 'X', attachments: null, metadata: null, created_at: '2026-01-01T00:00:00.000Z' };
    const mapped = mapMedicalRecordRow(row);
    expect(mapped.attachments).toEqual([]);
    expect(mapped.metadata).toEqual({});
  });
});
