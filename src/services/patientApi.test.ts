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

describe('bookConsultation / bookAndPayConsultation (enforced payment lock)', () => {
  const insertMock = jest.fn();
  const updateMock = jest.fn();
  const upsertMock = jest.fn();
  const singleMock = jest.fn();
  const selectMock = jest.fn();
  const fromMock = jest.fn();
  const invokeMock = jest.fn();
  const rowMock = jest.fn();

  const booking = {
    patientId: 'p1',
    doctorId: 'd1',
    scheduledAt: '2026-10-15T09:00:00.000Z',
    type: 'video' as const,
    fee: 30000,
    currencyCode: 'CDF',
    duration: 30,
  };
  const widgetOk = () => jest.fn(async () => ({ status: 'success' as const, payRef: 'ISW_PAY_REF_987654' }));
  const load = () => require('./patientApi');
  const insertedPayload = () => insertMock.mock.calls[0][0];

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    invokeMock.mockResolvedValue({ data: { success: true }, error: null });
    singleMock.mockResolvedValue({ data: { id: 'consult-1' }, error: null });
    selectMock.mockReturnValue({ single: singleMock });
    insertMock.mockReturnValue({ select: selectMock });
    // Relecture après confirm : la base dit `scheduled` + `paid` (valeurs serveur).
    rowMock.mockResolvedValue({ data: { id: 'consult-1', status: 'scheduled', payment_status: 'paid', scheduled_at: '2099-01-01T09:00:00Z' }, error: null });
    fromMock.mockReturnValue({
      insert: insertMock,
      update: updateMock,
      upsert: upsertMock,
      select: () => ({ eq: () => ({ maybeSingle: rowMock }) }),
    });
    jest.doMock('@/lib/supabase', () => ({
      supabase: { from: fromMock, functions: { invoke: invokeMock }, auth: {
          refreshSession: jest.fn(),
          getSession: async () => ({ data: { session: { user: { id: 'patient-uid' } } }, error: null }),
        },
      },
      supabasePublic: null,
      supabaseConfigured: true,
    }));
  });

  afterEach(() => {
    jest.dontMock('@/lib/supabase');
  });

  it('persists the actual appointment duration, not a hardcoded default', async () => {
    await load().bookConsultation({ ...booking, duration: 60 });
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ duration: 60 }));
  });

  it('inserts status "pending_payment" with payment_status "pending" (guide: valid CHECK value)', async () => {
    await load().bookConsultation(booking);
    expect(fromMock).toHaveBeenCalledWith('consultations');
    expect(insertedPayload()).toMatchObject({
      patient_id: 'p1',
      doctor_id: 'd1',
      scheduled_at: '2026-10-15T09:00:00.000Z',
      duration: 30,
      consultation_type: 'video',
      status: 'pending_payment',
      payment_status: 'pending',
    });
  });

  it('sends the DB value "audio" (not "phone") for a phone booking', async () => {
    await load().bookConsultation({ ...booking, type: 'phone' as const });
    expect(insertedPayload().consultation_type).toBe('audio');
  });

  it('keeps video and chat unchanged on insert', async () => {
    await load().bookConsultation({ ...booking, type: 'chat' as const });
    expect(insertedPayload().consultation_type).toBe('chat');
  });

  it('reads a DB row typed "audio" as the phone type', () => {
    const base = { id: 'c1', doctor_id: 'd1', scheduled_at: '2099-01-01T09:00:00Z', status: 'scheduled' };
    expect(load().mapConsultation({ ...base, consultation_type: 'audio' }).type).toBe('phone');
  });

  it('expose cancel_reason (médecin absent) et laisse undefined sans motif', () => {
    const base = { id: 'c1', doctor_id: 'd1', scheduled_at: '2099-01-01T09:00:00Z', status: 'cancelled' };
    expect(load().mapConsultation({ ...base, cancel_reason: 'provider_absent' })).toMatchObject({
      status: 'cancelled',
      cancelReason: 'provider_absent',
    });
    expect(load().mapConsultation({ ...base, cancel_reason: null }).cancelReason).toBeUndefined();
    expect(load().mapConsultation(base).cancelReason).toBeUndefined();
  });

  it('maps an empty video_room_id to undefined (it would break the call route), keeps a real one', () => {
    const base = { id: 'c1', doctor_id: 'd1', scheduled_at: '2099-01-01T09:00:00Z', status: 'scheduled' };
    expect(load().mapConsultation({ ...base, video_room_id: '' }).roomId).toBeUndefined();
    expect(load().mapConsultation({ ...base, video_room_id: null }).roomId).toBeUndefined();
    expect(load().mapConsultation({ ...base, video_room_id: 'room-1' }).roomId).toBe('room-1');
  });

  it('inserts the amount and currency displayed by public_provider_listing, without recomputing a fee', async () => {
    await load().bookConsultation({ ...booking, fee: 27500, currencyCode: 'USD' });
    expect(insertedPayload()).toMatchObject({ payment_amount: 27500, currency: 'USD' });
    expect(Object.keys(insertedPayload())).not.toContain('fee_percent_at_booking');
    expect(Object.keys(insertedPayload())).not.toContain('payment_reference');
  });

  it('refuses to insert when the listing gave no tariff (visitor view: fee/currency null)', async () => {
    await expect(load().bookConsultation({ ...booking, fee: null, currencyCode: null })).rejects.toThrow(
      'Connectez-vous pour voir le tarif et les disponibilités',
    );
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('bookConsultation only inserts: no Edge Function call at all, no payment-initiate(-v2)', async () => {
    const res = await load().bookConsultation(booking);
    expect(res).toEqual({ id: 'consult-1' });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('bookAndPayConsultation: insert → register → widget → confirm, in that order, never payment-initiate-v2', async () => {
    const order: string[] = [];
    insertMock.mockImplementation((payload: unknown) => {
      order.push('insert');
      return { select: selectMock };
    });
    invokeMock.mockImplementation(async (name: string) => {
      order.push(name);
      return { data: { success: true }, error: null };
    });
    const openPaymentWidget = jest.fn(async (txnRef: string) => {
      order.push(`widget:${txnRef.slice(0, 3)}`);
      return { status: 'success' as const, payRef: 'ISW_PAY_REF_987654' };
    });
    const res = await load().bookAndPayConsultation(booking, openPaymentWidget);
    expect(order).toEqual(['insert', 'register-payment-attempt', 'widget:VDC', 'confirm-consultation-payment']);
    const txnRef = openPaymentWidget.mock.calls[0][0];
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'register-payment-attempt', {
      body: { consultationId: 'consult-1', txnRef, useWallet: false },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'confirm-consultation-payment', {
      body: { consultationId: 'consult-1', txnRef, payRef: 'ISW_PAY_REF_987654', useWallet: false },
    });
    expect(invokeMock.mock.calls.map((c) => c[0])).not.toContain('payment-initiate-v2');
    expect(invokeMock.mock.calls.map((c) => c[0])).not.toContain('payment-initiate');
    expect(res).toEqual({ id: 'consult-1', payment: 'confirmed', txnRef });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('widget cancelled: consultation stays pending_payment, confirm not called, nothing updated', async () => {
    const openPaymentWidget = jest.fn(async () => ({ status: 'cancelled' as const }));
    const res = await load().bookAndPayConsultation(booking, openPaymentWidget);
    expect(res).toMatchObject({ id: 'consult-1', payment: 'cancelled' });
    expect(invokeMock.mock.calls.map((c) => c[0])).toEqual(['register-payment-attempt']);
    expect(updateMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('NOT_PAYABLE: widget not opened, confirm not called, the error propagates with the consultation id', async () => {
    invokeMock.mockResolvedValue({ data: { success: false, code: 'NOT_PAYABLE' }, error: null });
    const openPaymentWidget = jest.fn();
    await expect(load().bookAndPayConsultation(booking, openPaymentWidget)).rejects.toMatchObject({
      name: 'PaymentNotPayableError',
      code: 'NOT_PAYABLE',
      consultationId: 'consult-1',
    });
    expect(openPaymentWidget).not.toHaveBeenCalled();
    expect(invokeMock.mock.calls.map((c) => c[0])).toEqual(['register-payment-attempt']);
  });

  it('a widget that cannot launch leaves the booked consultation pending_payment (error carries its id)', async () => {
    const openPaymentWidget = jest.fn().mockRejectedValue(new Error('widget unavailable'));
    await expect(load().bookAndPayConsultation(booking, openPaymentWidget)).rejects.toMatchObject({
      message: 'widget unavailable',
      consultationId: 'consult-1',
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  describe('payExistingConsultation', () => {
    it('refuses to pay a consultation the database already shows as paid: no register, no widget', async () => {
      const openPaymentWidget = jest.fn();
      await expect(load().payExistingConsultation('consult-1', openPaymentWidget)).resolves.toEqual({ status: 'already_paid' });
      expect(openPaymentWidget).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalled();
    });

    it('retries a pending_payment consultation with register → widget (new txnRef) and tags errors with the id', async () => {
      rowMock.mockResolvedValue({ data: { id: 'consult-1', status: 'pending_payment', payment_status: 'pending' }, error: null });
      const openPaymentWidget = jest.fn().mockRejectedValue(new Error('widget unavailable'));
      await expect(load().payExistingConsultation('consult-1', openPaymentWidget)).rejects.toMatchObject({
        message: 'widget unavailable',
        consultationId: 'consult-1',
      });
      expect(invokeMock.mock.calls.map((c) => c[0])).toEqual(['register-payment-attempt']);
      expect(updateMock).not.toHaveBeenCalled();
    });
  });

  it('maps a Postgres exclusion-violation (23P01) to the existing overlap message', async () => {
    singleMock.mockResolvedValue({ data: null, error: { code: '23P01', message: 'exclusion' } });
    const { bookConsultation, SlotUnavailableError: Err } = load();
    const err = await bookConsultation(booking).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Err);
    expect(err.reason).toBe('overlap');
    expect(err.message).toBe("Ce créneau vient d'être réservé, choisissez-en un autre.");
  });

  it('maps the specific one_booking_per_provider_per_day unique violation to SlotUnavailableError("daily-limit")', async () => {
    singleMock.mockResolvedValue({
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "one_booking_per_provider_per_day"',
      },
    });
    await expect(load().bookConsultation(booking)).rejects.toMatchObject({
      name: 'SlotUnavailableError',
      reason: 'daily-limit',
    });
  });

  it('does not misreport an unrelated unique-violation (23505) as the daily-limit conflict', async () => {
    singleMock.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "some_other_index"' },
    });
    await expect(load().bookConsultation(booking)).rejects.toMatchObject({
      code: '23505',
      message: expect.stringContaining('some_other_index'),
    });
  });

  it.each([
    ['payment_fields_locked', '42501', 'payment_locked'],
    ['insert_amount_out_of_range', 'P0001', 'amount_out_of_range'],
  ])('%s surfaces a clear error and is never retried by a client update', async (marker, code, reason) => {
    singleMock.mockResolvedValue({ data: null, error: { code, message: `${marker}: rejected by trigger` } });
    const { bookConsultation, BookingRejectedError } = load();
    const err = await bookConsultation(booking).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BookingRejectedError);
    expect(err.reason).toBe(reason);
    expect(err.message).not.toMatch(/payment_fields_locked|insert_amount_out_of_range/);
    expect(err.message.length).toBeGreaterThan(20);
    expect(updateMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('through bookAndPayConsultation a locked insert never reaches register / widget / update', async () => {
    singleMock.mockResolvedValue({ data: null, error: { code: '42501', message: 'payment_fields_locked' } });
    const openPaymentWidget = jest.fn();
    await expect(load().bookAndPayConsultation(booking, openPaymentWidget)).rejects.toMatchObject({
      name: 'BookingRejectedError',
    });
    expect(openPaymentWidget).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('the client never sends payment_status "paid" or status "scheduled" in any captured payload', async () => {
    await load().bookAndPayConsultation(booking, widgetOk());
    await load().bookAndPayConsultation(booking, jest.fn(async () => ({ status: 'cancelled' as const })));
    const payloads = [
      ...insertMock.mock.calls.map((c) => c[0]),
      ...invokeMock.mock.calls.map((c) => c[1].body),
      ...updateMock.mock.calls.map((c) => c[0]),
    ];
    expect(payloads.length).toBeGreaterThan(0);
    for (const payload of payloads) {
      expect(payload.payment_status).not.toBe('paid');
      expect(payload.status).not.toBe('scheduled');
      expect(JSON.stringify(payload)).not.toMatch(/"paid"|"scheduled"/);
    }
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe('getConsultationById (re-read after payment)', () => {
  const maybeSingleMock = jest.fn();
  const eqMock = jest.fn();
  const selectMock = jest.fn();
  const fromMock = jest.fn();
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    eqMock.mockReturnValue({ maybeSingle: maybeSingleMock });
    selectMock.mockReturnValue({ eq: eqMock });
    fromMock.mockReturnValue({ select: selectMock });
    jest.doMock('@/lib/supabase', () => ({
      supabase: { from: fromMock, functions: { invoke: jest.fn() } },
      supabasePublic: null,
      supabaseConfigured: true,
    }));
  });
  afterEach(() => jest.dontMock('@/lib/supabase'));

  it('reads the row from the database: status/payment are the server values, never local state', async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        id: 'c1',
        doctor_id: 'd1',
        scheduled_at: '2026-10-15T09:00:00.000Z',
        status: 'scheduled',
        payment_status: 'paid',
        payment_amount: 30000,
        currency: 'CDF',
        doctor: { id: 'd1', first_name: 'A', last_name: 'B' },
      },
      error: null,
    });
    const c = await require('./patientApi').getConsultationById('c1');
    expect(fromMock).toHaveBeenCalledWith('consultations');
    expect(eqMock).toHaveBeenCalledWith('id', 'c1');
    expect(c).toMatchObject({ id: 'c1', status: 'confirmed', awaitingPayment: false });
  });

  it('still pending_payment when the server has not confirmed yet', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { id: 'c1', doctor_id: 'd1', scheduled_at: '2026-10-15T09:00:00.000Z', status: 'pending_payment', payment_status: 'pending' },
      error: null,
    });
    const c = await require('./patientApi').getConsultationById('c1');
    expect(c).toMatchObject({ status: 'pending', awaitingPayment: true });
  });

  it('returns null when the row is not visible', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    expect(await require('./patientApi').getConsultationById('c1')).toBeNull();
  });
});

describe('mapConsultation (payment lock)', () => {
  const row = (over: Record<string, unknown>) => ({
    id: 'c1',
    doctor_id: 'd1',
    scheduled_at: '2026-10-15T09:00:00.000Z',
    duration: 30,
    consultation_type: 'video',
    payment_amount: 30000,
    currency: 'CDF',
    status: 'scheduled',
    payment_status: 'paid',
    ...over,
  });
  it('a pending_payment consultation is awaiting payment, not confirmed', () => {
    const { mapConsultation } = require('./patientApi');
    const c = mapConsultation(row({ status: 'pending_payment', payment_status: 'pending' }));
    expect(c.status).toBe('pending');
    expect(c.awaitingPayment).toBe(true);
    expect(c.currency).toBe('CDF');
  });
  it('exposes created_at so an expired unpaid reservation can be recognised', () => {
    const { mapConsultation } = require('./patientApi');
    expect(mapConsultation(row({ created_at: '2026-11-08T10:00:00Z' })).createdAt).toBe('2026-11-08T10:00:00Z');
  });
  it('status and payment come from the database row: scheduled + paid is confirmed', () => {
    const { mapConsultation } = require('./patientApi');
    const c = mapConsultation(row({}));
    expect(c.status).toBe('confirmed');
    expect(c.awaitingPayment).toBe(false);
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

describe('mapWalletCreditRow (avoir noshow_credit)', () => {
  it('affiche « Remboursement : médecin absent » comme un crédit, en unité principale', () => {
    const tx = require('./patientApi').mapWalletCreditRow({ id: 'w1', amount: '15000.00', created_at: '2026-11-17T10:12:00.000Z' });
    expect(tx).toMatchObject({ id: 'wallet-w1', label: 'Remboursement : médecin absent', amount: 15000 });
    expect(tx.method).toBeUndefined();
  });
});

describe('mapWalletCreditRow (avoir cancellation_credit)', () => {
  it("affiche « Crédit d'annulation » comme un crédit, en unité principale", () => {
    const tx = require('./patientApi').mapWalletCreditRow({
      id: 'w2',
      transaction_type: 'cancellation_credit',
      amount: '30000.00',
      created_at: '2026-11-19T10:12:00.000Z',
    });
    expect(tx).toMatchObject({ id: 'wallet-w2', label: "Crédit d'annulation", amount: 30000 });
  });
});

describe('getWallet avec avoirs noshow_credit', () => {
  const fromMock = jest.fn();
  let walletResult: { data: unknown; error: unknown } | undefined;
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    fromMock.mockImplementation((table: string) => ({
      select: () => {
        const q: any = {};
        q.eq = () => q;
        q.in = () => q;
        q.order = () => q;
        q.limit = () =>
          Promise.resolve(
            table === 'patient_wallet_transactions'
              ? walletResult
              : {
                  data: [{ id: 'pay', amount: 1_000_000, status: 'SUCCESS', created_at: '2026-11-10T10:00:00.000Z' }],
                  error: null,
                },
          );
        return q;
      },
    }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: fromMock }, supabasePublic: null, supabaseConfigured: true }));
  });
  afterEach(() => jest.dontMock('@/lib/supabase'));

  it('fusionne les avoirs noshow_credit (seulement) dans l’historique, du plus récent au plus ancien', async () => {
    walletResult = {
      data: [
        { id: 'c1', transaction_type: 'noshow_credit', amount: 10000, created_at: '2026-11-16T10:00:00.000Z' },
        { id: 'b1', transaction_type: 'booking_debit', amount: -5000, created_at: '2026-11-16T11:00:00.000Z' },
        { id: 'a1', transaction_type: 'cancellation_credit', amount: 7000, created_at: '2026-11-15T10:00:00.000Z' },
      ],
      error: null,
    };
    const wallet = await require('./patientApi').getWallet('pat-1');
    expect(fromMock).toHaveBeenCalledWith('patient_wallet_transactions');
    expect(wallet.transactions.map((t: { id: string }) => t.id)).toEqual(['wallet-c1', 'wallet-a1', 'pay']);
    expect(wallet.transactions[1]).toMatchObject({ label: "Crédit d'annulation", amount: 7000 });
    expect(wallet.transactions[0]).toMatchObject({ label: 'Remboursement : médecin absent', amount: 10000 });
    expect(wallet.balance).toBe(10000); // total payé inchangé : 1 000 000 / 100
  });

  it('une erreur sur les avoirs (RLS) n’empêche pas d’afficher les paiements', async () => {
    walletResult = { data: null, error: { code: '42501', message: 'denied' } };
    const wallet = await require('./patientApi').getWallet('pat-1');
    expect(wallet.transactions.map((t: { id: string }) => t.id)).toEqual(['pay']);
  });
});

describe('getWallet embed fallback (PGRST200: relationship not found)', () => {
  const fromMock = jest.fn();
  const selects: string[] = [];
  const results: { data: unknown; error: unknown }[] = [];

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    selects.length = 0;
    results.length = 0;
    fromMock.mockImplementation((table: string) => ({
      select: (sel: string) => {
        if (table === 'patient_wallet_transactions') {
          const w: any = { eq: () => w, in: () => w, order: () => w, limit: () => Promise.resolve({ data: [], error: null }) };
          return w;
        }
        selects.push(sel);
        const q: any = {};
        q.eq = () => q;
        q.order = () => q;
        q.limit = () => Promise.resolve(results.shift());
        return q;
      },
    }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: fromMock }, supabasePublic: null, supabaseConfigured: true }));
  });
  afterEach(() => jest.dontMock('@/lib/supabase'));

  const row = { id: 'p1', amount: 100_000, status: 'SUCCESS', created_at: '2026-06-10T10:00:00.000Z' };

  it('retries WITHOUT the provider embed on PGRST200 and still returns the wallet (names absent)', async () => {
    results.push(
      { data: null, error: { code: 'PGRST200', message: "Could not find a relationship between 'payment_transactions_v2' and 'provider_identity'" } },
      { data: [row], error: null },
    );
    const wallet = await require('./patientApi').getWallet('pat-1');
    expect(selects).toHaveLength(2);
    expect(selects[0]).toContain('provider_identity');
    expect(selects[1]).not.toContain('provider_identity');
    expect(wallet.balance).toBe(1000);
    expect(wallet.transactions).toHaveLength(1);
    expect(wallet.transactions[0].method).toBeUndefined();
  });

  it('does not retry for any other error code: it still throws', async () => {
    results.push({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(require('./patientApi').getWallet('pat-1')).rejects.toMatchObject({ code: '42501' });
    expect(selects).toHaveLength(1);
  });

  it('throws when the retry itself fails', async () => {
    results.push({ data: null, error: { code: 'PGRST200', message: 'x' } }, { data: null, error: { code: '500', message: 'boom' } });
    await expect(require('./patientApi').getWallet('pat-1')).rejects.toMatchObject({ message: 'boom' });
  });

  it('does a single query when the embed works', async () => {
    results.push({ data: [row], error: null });
    await require('./patientApi').getWallet('pat-1');
    expect(selects).toHaveLength(1);
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

  // `specialties.labels` est un jsonb indexé par langue ({ fr: '…' }), jamais un tableau de chaînes.
  it.each([
    [{ fr: 'Médecine générale' }, 'Médecine générale'],
    [{ en: 'General medicine', fr: 'Médecine générale' }, 'Médecine générale'],
    [{ en: 'General medicine' }, 'General medicine'],
    [{ fr: '', en: 'Pediatrics' }, 'Pediatrics'],
    [[{ fr: 'Pédiatrie' }, { fr: 'Nutrition' }], 'Pédiatrie · Nutrition'],
    [{}, 'Médecin'],
    [{ fr: 42 }, 'Médecin'],
  ])('renders a locale-keyed specialty label %j as a plain string', async (labels, expected) => {
    sessionOrder.mockResolvedValue({ data: [{ ...rows[0], specialty_labels: labels }], error: null });
    const { getDoctors } = require('./patientApi');
    const [doctor] = await getDoctors({ signedIn: true });
    expect(typeof doctor.specialty).toBe('string');
    expect(doctor.specialty).toBe(expected);
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
    expect(select).toContain('video_room_id');
    expect(session).toEqual({ doctorName: 'Dr. Amara Diallo', initials: 'AD', roomId: 'c1' });
  });

  it('returns video_room_id as the call roomId when the consultation has one', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { id: 'c1', video_room_id: 'room-1', doctor: { first_name: 'Amara', last_name: 'Diallo' } },
      error: null,
    });
    const { getCallSession } = require('./patientApi');
    expect((await getCallSession('c1')).roomId).toBe('room-1');
  });

  it('accepts the call doctor embed as an array', async () => {
    maybeSingleMock.mockResolvedValue({ data: { id: 'c1', doctor: [{ first_name: 'Amara', last_name: 'Diallo' }] }, error: null });
    const { getCallSession } = require('./patientApi');
    expect(await getCallSession('room-1')).toEqual({ doctorName: 'Dr. Amara Diallo', initials: 'AD', roomId: 'c1' });
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
