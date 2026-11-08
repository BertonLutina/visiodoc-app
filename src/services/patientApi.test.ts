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
    invokeMock.mockResolvedValue({ data: { txnRef: 'T0' }, error: null });
    jest.doMock('expo-linking', () => ({ createURL: (path: string) => `visiodoc://${path}` }));
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
    jest.dontMock('expo-linking');
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

  it('inserts status "scheduled" (valid CHECK value) with payment_status "pending"', async () => {
    invokeMock.mockResolvedValue({ data: { txnRef: 'T1' }, error: null });
    const { bookConsultation: b } = require('./patientApi');
    await b({ patientId: 'p1', doctorId: 'd1', scheduledAt: '2026-10-15T09:00:00.000Z', type: 'video', fee: 5000, duration: 30 });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'scheduled', payment_status: 'pending' }),
    );
  });

  it('calls payment-initiate-v2 with the payload the Edge Function requires', async () => {
    invokeMock.mockResolvedValue({ data: { txnRef: 'T1' }, error: null });
    const { bookConsultation: b } = require('./patientApi');
    const res = await b({ patientId: 'p1', doctorId: 'd1', scheduledAt: '2026-10-15T09:00:00.000Z', type: 'video', fee: 5000, duration: 30, countryCode: 'CD' });
    expect(invokeMock).toHaveBeenCalledWith('payment-initiate-v2', {
      body: expect.objectContaining({
        countryCode: 'CD',
        method: 'MOBILE_MONEY',
        amountSmallestUnit: 500000,
        patientId: 'p1',
        providerId: 'd1',
        consultationId: 'consult-1',
        callbackUrl: expect.any(String),
      }),
    });
    expect(res.paymentIntent).toEqual({ txnRef: 'T1' });
  });

  it('throws PaymentInitiationError when the payment function fails', async () => {
    invokeMock.mockResolvedValue({ data: { error: 'INTEGRATOR_NOT_IMPLEMENTED' }, error: null });
    const { bookConsultation: b } = require('./patientApi');
    await expect(
      b({ patientId: 'p1', doctorId: 'd1', scheduledAt: '2026-10-15T09:00:00.000Z', type: 'video', fee: 5000, duration: 30 }),
    ).rejects.toMatchObject({ name: 'PaymentInitiationError', consultationId: 'consult-1' });
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

import { mapMedicalRecordRow, mapPaymentRow } from './patientApi';

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

describe('mapPaymentRow', () => {
  it('converts the smallest currency unit and marks a successful payment as a debit', () => {
    const tx = mapPaymentRow({
      id: 't1',
      amount: 1_500_000,
      status: 'SUCCESS',
      created_at: '2026-06-10T10:00:00.000Z',
      provider: { first_name: 'Amara', last_name: 'Diallo' },
    });
    expect(tx.amount).toBe(-15000);
    expect(tx.label).toBe('Paiement réussi');
    expect(tx.method).toBe('Amara Diallo');
    expect(tx.date).toBe(new Date('2026-06-10T10:00:00.000Z').toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }));
  });

  it('marks a refund as a credit and omits a missing doctor', () => {
    const tx = mapPaymentRow({
      id: 't2',
      amount: 500_000,
      status: 'REFUNDED',
      created_at: '2026-06-11T10:00:00.000Z',
      provider: null,
    });
    expect(tx.amount).toBe(5000);
    expect(tx.label).toBe('Paiement remboursé');
    expect(tx.method).toBeUndefined();
  });
});

describe('getWallet', () => {
  const limitMock = jest.fn();
  const orderMock = jest.fn();
  const eqMock = jest.fn();
  const selectMock = jest.fn();
  const fromMock = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    limitMock.mockResolvedValue({
      data: [
        { id: 'ok', amount: 2_000_000, status: 'SUCCESS', created_at: '2026-06-10T10:00:00.000Z', provider: { first_name: 'A', last_name: 'B' } },
        { id: 'no', amount: 500_000, status: 'FAILED', created_at: '2026-06-11T10:00:00.000Z', provider: null },
      ],
      error: null,
    });
    orderMock.mockReturnValue({ limit: limitMock });
    eqMock.mockReturnValue({ order: orderMock });
    selectMock.mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ select: selectMock });
    jest.doMock('@/lib/supabase', () => ({
      supabase: { from: fromMock },
      supabasePublic: null,
      supabaseConfigured: true,
    }));
  });

  afterEach(() => {
    jest.dontMock('@/lib/supabase');
  });

  it('reads the patient payment history and sums only successful payments', async () => {
    const { getWallet: getWalletFresh } = require('./patientApi');
    const wallet = await getWalletFresh('patient-real');
    expect(fromMock).toHaveBeenCalledWith('payment_transactions_v2');
    expect(eqMock).toHaveBeenCalledWith('patient_id', 'patient-real');
    expect(wallet.balance).toBe(20000);
    expect(wallet.transactions).toHaveLength(2);
    expect(wallet.transactions[0].amount).toBe(-20000);
    expect(wallet.aiCreditsLeft).toBe(0);
  });
});

describe('shouldHideCommercialInfo', () => {
  const { shouldHideCommercialInfo } = require('./patientApi');

  it('hides the fee and slots when the fee is null even for a signed-in user', () => {
    expect(shouldHideCommercialInfo(null, true)).toBe(true);
  });

  it('hides the fee and slots for a visitor even when a fee is present', () => {
    expect(shouldHideCommercialInfo(15000, false)).toBe(true);
  });

  it('hides everything for a visitor without fee', () => {
    expect(shouldHideCommercialInfo(null, false)).toBe(true);
  });

  it('shows the fee and slots for a signed-in user with a fee', () => {
    expect(shouldHideCommercialInfo(15000, true)).toBe(false);
  });

  it('treats a free (0) consultation as a real fee, not as hidden', () => {
    expect(shouldHideCommercialInfo(0, true)).toBe(false);
  });
});

describe('public doctor catalog (public_provider_listing)', () => {
  const LIST_SELECT = 'id, first_name, last_name, avatar_url, specialty_labels, consultation_fee, currency_code, city, rating';
  const DETAIL_SELECT =
    'id, first_name, last_name, avatar_url, bio, years_of_experience, qualifications, languages, country_id, city, rating, total_consultations, availability_status, specialty_id, specialty_labels, consultation_fee, currency_code';

  const sessionOrder = jest.fn();
  const sessionSelect = jest.fn();
  const sessionFrom = jest.fn();
  const publicOrder = jest.fn();
  const publicSelect = jest.fn();
  const publicFrom = jest.fn();
  const publicMaybeSingle = jest.fn();
  const publicEq = jest.fn();
  const sessionMaybeSingle = jest.fn();
  const sessionEq = jest.fn();

  const rows = [
    {
      id: 'd1',
      first_name: 'Amara',
      last_name: 'Diallo',
      avatar_url: 'https://cdn/x.png',
      specialty_labels: ['Médecine générale', 'Pédiatrie'],
      consultation_fee: 15000,
      currency_code: 'CDF',
      city: 'Kinshasa',
      rating: 4.9,
    },
    {
      id: 'd2',
      first_name: 'Ngozi',
      last_name: 'Kamau',
      avatar_url: null,
      specialty_labels: null,
      consultation_fee: null,
      currency_code: null,
      city: null,
      rating: null,
    },
  ];

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    sessionOrder.mockResolvedValue({ data: rows, error: null });
    sessionSelect.mockReturnValue({ order: sessionOrder, eq: sessionEq });
    sessionFrom.mockReturnValue({ select: sessionSelect });
    publicOrder.mockResolvedValue({ data: rows, error: null });
    publicSelect.mockReturnValue({ order: publicOrder, eq: publicEq });
    publicFrom.mockReturnValue({ select: publicSelect });
    publicMaybeSingle.mockResolvedValue({ data: { ...rows[0], bio: 'b', years_of_experience: 8, total_consultations: 240, availability_status: 'available' }, error: null });
    publicEq.mockReturnValue({ maybeSingle: publicMaybeSingle });
    sessionMaybeSingle.mockResolvedValue({ data: null, error: null });
    sessionEq.mockReturnValue({ maybeSingle: sessionMaybeSingle });
    jest.doMock('@/lib/supabase', () => ({
      supabase: { from: sessionFrom },
      supabasePublic: { from: publicFrom },
      supabaseConfigured: true,
    }));
  });

  afterEach(() => {
    jest.dontMock('@/lib/supabase');
  });

  it('reads public_provider_listing (never users) with the exact columns, best rated first', async () => {
    const { getDoctors } = require('./patientApi');
    await getDoctors();
    expect(publicFrom).toHaveBeenCalledTimes(1);
    expect(publicFrom).toHaveBeenCalledWith('public_provider_listing');
    expect(publicFrom).not.toHaveBeenCalledWith('users');
    expect(publicSelect).toHaveBeenCalledWith(LIST_SELECT);
    expect(publicOrder).toHaveBeenCalledWith('rating', { ascending: false });
  });

  it('uses the anonymous client for a visitor', async () => {
    const { getDoctors } = require('./patientApi');
    await getDoctors({ signedIn: false });
    expect(publicFrom).toHaveBeenCalledWith('public_provider_listing');
    expect(sessionFrom).not.toHaveBeenCalled();
  });

  it('uses the session client when signed in, so the fee is not null', async () => {
    const { getDoctors } = require('./patientApi');
    await getDoctors({ signedIn: true });
    expect(sessionFrom).toHaveBeenCalledWith('public_provider_listing');
    expect(sessionSelect).toHaveBeenCalledWith(LIST_SELECT);
    expect(sessionOrder).toHaveBeenCalledWith('rating', { ascending: false });
    expect(publicFrom).not.toHaveBeenCalled();
  });

  it('maps rows, keeping a null fee and currency as null (no 0, no NaN)', async () => {
    const { getDoctors } = require('./patientApi');
    const doctors = await getDoctors({ signedIn: true });
    expect(doctors).toHaveLength(2);
    expect(doctors[0]).toMatchObject({
      id: 'd1',
      firstName: 'Amara',
      lastName: 'Diallo',
      specialty: 'Médecine générale · Pédiatrie',
      city: 'Kinshasa',
      fee: 15000,
      currencyCode: 'CDF',
      rating: 4.9,
      initials: 'AD',
      avatarUrl: 'https://cdn/x.png',
    });
    expect(doctors[1]).toMatchObject({
      id: 'd2',
      specialty: 'Médecin',
      city: '',
      fee: null,
      currencyCode: null,
      rating: 0,
      initials: 'NK',
    });
    expect(doctors[1].avatarUrl).toBeUndefined();
  });

  it('propagates a catalog error', async () => {
    publicOrder.mockResolvedValue({ data: null, error: new Error('boom') });
    const { getDoctors } = require('./patientApi');
    await expect(getDoctors()).rejects.toThrow('boom');
  });

  it('reads the doctor profile from the same view, by id', async () => {
    const { getDoctor } = require('./patientApi');
    const doctor = await getDoctor('d1', { signedIn: false });
    expect(publicFrom).toHaveBeenCalledWith('public_provider_listing');
    expect(publicFrom).not.toHaveBeenCalledWith('users');
    expect(publicSelect).toHaveBeenCalledWith(DETAIL_SELECT);
    expect(publicEq).toHaveBeenCalledWith('id', 'd1');
    expect(doctor).toMatchObject({ id: 'd1', fee: 15000, yearsOfExperience: 8, availabilityLabel: 'Dispo auj.' });
  });

  it('uses the session client for the profile when signed in, and returns null when absent', async () => {
    const { getDoctor } = require('./patientApi');
    const doctor = await getDoctor('ghost', { signedIn: true });
    expect(sessionFrom).toHaveBeenCalledWith('public_provider_listing');
    expect(sessionEq).toHaveBeenCalledWith('id', 'ghost');
    expect(publicFrom).not.toHaveBeenCalled();
    expect(doctor).toBeNull();
  });
});

describe('patient-side doctor identity goes through provider_identity', () => {
  const orderMock = jest.fn();
  const inMock = jest.fn();
  const eqMock = jest.fn();
  const selectMock = jest.fn();
  const fromMock = jest.fn();
  const maybeSingleMock = jest.fn();
  const limitMock = jest.fn();
  const orMock = jest.fn();

  const consultationRow = {
    id: 'c1',
    doctor_id: 'd1',
    scheduled_at: '2026-10-15T09:00:00.000Z',
    status: 'scheduled',
    payment_status: 'paid',
    consultation_type: 'video',
    duration: 30,
    payment_amount: 5000,
    video_room_id: 'room-1',
    doctor: { id: 'd1', first_name: 'Amara', last_name: 'Diallo', avatar_url: 'https://cdn/a.png', specialization: 'Pédiatrie' },
  };

  const selectArg = (): string => String(selectMock.mock.calls[0][0]);

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    orderMock.mockResolvedValue({ data: [consultationRow], error: null });
    inMock.mockReturnValue({ order: orderMock });
    eqMock.mockReturnValue({ in: inMock, order: orderMock });
    maybeSingleMock.mockResolvedValue({ data: { id: 'c1', doctor: { first_name: 'Amara', last_name: 'Diallo' } }, error: null });
    limitMock.mockReturnValue({ maybeSingle: maybeSingleMock });
    orMock.mockReturnValue({ limit: limitMock });
    selectMock.mockReturnValue({ eq: eqMock, or: orMock });
    fromMock.mockReturnValue({ select: selectMock });
    jest.doMock('@/lib/supabase', () => ({
      supabase: { from: fromMock },
      supabasePublic: null,
      supabaseConfigured: true,
    }));
  });

  afterEach(() => {
    jest.dontMock('@/lib/supabase');
  });

  it('selects the consultation doctor from provider_identity with only public columns', async () => {
    const { getUpcomingConsultations } = require('./patientApi');
    await getUpcomingConsultations('patient-1');
    expect(fromMock).toHaveBeenCalledWith('consultations');
    const select = selectArg();
    expect(select).toContain('doctor:provider_identity!doctor_id');
    expect(select).toContain('specialization');
    expect(select).not.toContain('doctor:users');
    expect(select).not.toContain('healthcare_professionals');
    expect(select).not.toContain('email');
    expect(select).not.toContain('phone');
  });

  it('uses the same identity join for past consultations', async () => {
    const { getPastConsultations } = require('./patientApi');
    await getPastConsultations('patient-1');
    expect(selectArg()).toContain('doctor:provider_identity!doctor_id');
  });

  it('maps the doctor name, avatar and specialization from the view row', async () => {
    const { getUpcomingConsultations } = require('./patientApi');
    const [consultation] = await getUpcomingConsultations('patient-1');
    expect(consultation.doctor).toEqual({
      id: 'd1',
      firstName: 'Amara',
      lastName: 'Diallo',
      specialty: 'Pédiatrie',
      initials: 'AD',
      avatarUrl: 'https://cdn/a.png',
    });
  });

  it('keeps empty specialty and no avatar when the view returns nulls', async () => {
    const { mapConsultation } = require('./patientApi');
    const c = mapConsultation({
      ...consultationRow,
      doctor: { id: 'd1', first_name: 'Amara', last_name: 'Diallo', avatar_url: null, specialization: null },
    });
    expect(c.doctor.specialty).toBe('');
    expect(c.doctor.avatarUrl).toBeUndefined();
  });

  it('joins a text[] specialization with " · "', () => {
    const { mapConsultation } = require('./patientApi');
    const c = mapConsultation({ ...consultationRow, doctor: { ...consultationRow.doctor, specialization: ['Pédiatrie', 'Nutrition'] } });
    expect(c.doctor.specialty).toBe('Pédiatrie · Nutrition');
  });

  it('accepts the embed as a one-element array', () => {
    const { mapConsultation } = require('./patientApi');
    const c = mapConsultation({ ...consultationRow, doctor: [consultationRow.doctor] });
    expect(c.doctor).toMatchObject({ id: 'd1', firstName: 'Amara', lastName: 'Diallo', specialty: 'Pédiatrie', avatarUrl: 'https://cdn/a.png' });
  });

  it('falls back to doctor_id when the embed is empty', () => {
    const { mapConsultation } = require('./patientApi');
    const c = mapConsultation({ ...consultationRow, doctor: null });
    expect(c.doctor).toMatchObject({ id: 'd1', firstName: '', lastName: '', specialty: '' });
  });

  it('reads the wallet payment provider from provider_identity, never users', async () => {
    const limit = jest.fn().mockResolvedValue({ data: [], error: null });
    orderMock.mockReturnValue({ limit });
    const { getWallet } = require('./patientApi');
    await getWallet('patient-1');
    expect(fromMock).toHaveBeenCalledWith('payment_transactions_v2');
    const select = selectArg();
    expect(select).toContain('provider:provider_identity!provider_id');
    expect(select).not.toContain('users');
    expect(select).not.toContain('email');
    expect(select).not.toContain('phone');
  });

  it('reads the call doctor from provider_identity and builds the display name', async () => {
    const { getCallSession } = require('./patientApi');
    const session = await getCallSession('room-1');
    expect(fromMock).toHaveBeenCalledWith('consultations');
    const select = selectArg();
    expect(select).toContain('doctor:provider_identity!doctor_id');
    expect(select).not.toContain('doctor:users');
    expect(select).not.toContain('email');
    expect(select).not.toContain('phone');
    expect(session).toEqual({ doctorName: 'Dr. Amara Diallo', initials: 'AD' });
  });

  it('accepts the call doctor embed as an array', async () => {
    maybeSingleMock.mockResolvedValue({ data: { id: 'c1', doctor: [{ first_name: 'Amara', last_name: 'Diallo' }] }, error: null });
    const { getCallSession } = require('./patientApi');
    expect(await getCallSession('room-1')).toEqual({ doctorName: 'Dr. Amara Diallo', initials: 'AD' });
  });
});

describe('patient service source guard', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const source: string = require('fs').readFileSync(require('path').resolve(process.cwd(), 'src/services/patientApi.ts'), 'utf8');

  it('never embeds a provider through the users table', () => {
    expect(source).not.toMatch(/\b(doctor|provider)\s*:\s*users\b/);
    expect(source).not.toMatch(/healthcare_professionals/);
  });

  it('never selects email or phone inside a provider_identity embed', () => {
    const embeds = source.match(/provider_identity![a-z_]+\s*\([^)]*\)/g) ?? [];
    expect(embeds.length).toBeGreaterThanOrEqual(3);
    for (const embed of embeds) {
      expect(embed).not.toMatch(/\b(email|phone)\b/);
    }
  });
});
