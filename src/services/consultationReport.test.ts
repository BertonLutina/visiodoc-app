/** Chaîne PostgREST simulée : chaque appel est enregistré, la chaîne se résout avec la prochaine réponse. */
const mockCalls: { table: string; ops: [string, any[]][] }[] = [];
const mockInvoke = jest.fn();
let mockResponses: { data: any; error: any }[] = [];

jest.mock('@/lib/supabase', () => {
  const make = (table: string) => {
    const entry = { table, ops: [] as [string, any[]][] };
    mockCalls.push(entry);
    const chain: any = {};
    for (const m of ['select', 'update', 'insert', 'eq', 'is', 'or', 'limit', 'maybeSingle', 'single']) {
      chain[m] = (...args: any[]) => {
        entry.ops.push([m, args]);
        return chain;
      };
    }
    chain.then = (resolve: any, reject: any) =>
      Promise.resolve(mockResponses.shift() ?? { data: null, error: null }).then(resolve, reject);
    return chain;
  };
  return {
    supabaseConfigured: true,
    supabase: { from: (t: string) => make(t), functions: { invoke: (...a: any[]) => mockInvoke(...a) } },
  };
});

import {
  ConsultationReportError,
  endConsultation,
  getConsultationReport,
  getPatientJoinedAt,
  getProviderCallContext,
  logVideoSessionEnd,
  logVideoSessionStart,
  markPatientAbsent,
  notifyConsultationStarted,
  saveConsultationReport,
} from './consultationReport';

const opsOf = (i: number, name: string) => mockCalls[i].ops.filter(([n]) => n === name).map(([, a]) => a);
const FIELDS = { notes: ' N ', diagnosis: '', prescription: 'P' };

beforeEach(() => {
  mockCalls.length = 0;
  mockResponses = [];
});

describe('getConsultationReport', () => {
  it('filtre sur le prestataire et lit enfant + patient', async () => {
    mockResponses = [
      {
        data: {
          id: 'c1', status: 'in_progress', updated_at: 'U1', notes: 'n', diagnosis: null, prescription: null,
          child_id: 'k1',
          patient: { first_name: 'Ada', last_name: 'Mbo', date_of_birth: '1990-01-01' },
          child: { first_name: 'Léa', last_name: 'Mbo', date_of_birth: '2019-01-01' },
        },
        error: null,
      },
    ];
    const r = await getConsultationReport('c1', 'd1');
    expect(opsOf(0, 'eq')).toEqual([['id', 'c1'], ['doctor_id', 'd1']]);
    expect(r.isChild).toBe(true);
    expect(r.child?.firstName).toBe('Léa');
    expect(r.diagnosis).toBe('');
    expect(r.updatedAt).toBe('U1');
  });

  it("relit sans l'enfant si la jointure échoue, et signale tout de même l'enfant via child_id", async () => {
    mockResponses = [
      { data: null, error: { message: 'x' } },
      { data: { id: 'c1', status: 'completed', child_id: 'k1', patient: { first_name: 'A', last_name: 'B' } }, error: null },
    ];
    const r = await getConsultationReport('c1', 'd1');
    expect(mockCalls).toHaveLength(2);
    expect(r.isChild).toBe(true);
    expect(r.child).toBeNull();
  });

  it('absente : not_found', async () => {
    mockResponses = [{ data: null, error: null }];
    await expect(getConsultationReport('c1', 'd1')).rejects.toMatchObject({ kind: 'not_found' });
  });
});

describe('saveConsultationReport', () => {
  it('relit updated_at puis écrit (vide devient null), conditionné à updated_at', async () => {
    mockResponses = [
      { data: { id: 'c1', updated_at: 'U1' }, error: null },
      { data: [{ id: 'c1', updated_at: 'U2' }], error: null },
    ];
    const r = await saveConsultationReport('c1', 'd1', FIELDS, 'U1');
    expect(r.updatedAt).toBe('U2');
    expect(opsOf(1, 'update')[0][0]).toEqual({ notes: ' N ', diagnosis: null, prescription: 'P' });
    expect(opsOf(1, 'eq')).toEqual([['id', 'c1'], ['doctor_id', 'd1'], ['updated_at', 'U1']]);
    expect(opsOf(1, 'select')[0]).toEqual(['id, updated_at']);
    expect(mockCalls.every((c) => c.table === 'consultations')).toBe(true);
  });

  it("refuse d'écraser si updated_at a changé (aucun UPDATE)", async () => {
    mockResponses = [{ data: { id: 'c1', updated_at: 'U9' }, error: null }];
    await expect(saveConsultationReport('c1', 'd1', FIELDS, 'U1')).rejects.toMatchObject({ kind: 'conflict' });
    expect(mockCalls).toHaveLength(1);
  });

  it('modification entre la relecture et ecriture (0 ligne) : conflit', async () => {
    mockResponses = [
      { data: { id: 'c1', updated_at: 'U1' }, error: null },
      { data: [], error: null },
    ];
    await expect(saveConsultationReport('c1', 'd1', FIELDS, 'U1')).rejects.toBeInstanceOf(ConsultationReportError);
  });

  it('0 ligne sans updated_at connu : erreur traduite not_found', async () => {
    mockResponses = [
      { data: { id: 'c1', updated_at: null }, error: null },
      { data: [], error: null },
    ];
    await expect(saveConsultationReport('c1', 'd1', FIELDS, null)).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('consultation non lisible : not_found, rien écrit', async () => {
    mockResponses = [{ data: null, error: null }];
    await expect(saveConsultationReport('c1', 'd1', FIELDS, 'U1')).rejects.toMatchObject({ kind: 'not_found' });
    expect(mockCalls).toHaveLength(1);
  });
});

describe('endConsultation', () => {
  it('ended_at (si nul) puis status completed, sans autre colonne', async () => {
    mockResponses = [
      { data: [{ id: 'c1' }], error: null },
      { data: [{ id: 'c1', updated_at: 'U3' }], error: null },
    ];
    const r = await endConsultation('c1', 'd1');
    expect(r.updatedAt).toBe('U3');
    const first = opsOf(0, 'update')[0][0];
    expect(Object.keys(first)).toEqual(['ended_at']);
    expect(opsOf(0, 'is')).toEqual([['ended_at', null]]);
    expect(opsOf(1, 'update')[0][0]).toEqual({ status: 'completed' });
    expect(opsOf(1, 'eq')).toEqual([['id', 'c1'], ['doctor_id', 'd1']]);
  });

  it('refus 42501 : message clair never_started', async () => {
    mockResponses = [
      { data: [], error: null },
      { data: null, error: { code: '42501', message: 'a call that was never started cannot be completed' } },
    ];
    await expect(endConsultation('c1', 'd1')).rejects.toMatchObject({ kind: 'never_started' });
  });

  it('autre erreur : unavailable, jamais le texte brut', async () => {
    mockResponses = [{ data: null, error: { code: 'XX', message: 'texte serveur Léa' } }];
    const e: any = await endConsultation('c1', 'd1').catch((x) => x);
    expect(e.kind).toBe('unavailable');
    expect(e.message).not.toContain('Léa');
  });

  it('0 ligne au passage completed : not_found', async () => {
    mockResponses = [
      { data: [], error: null },
      { data: [], error: null },
    ];
    await expect(endConsultation('c1', 'd1')).rejects.toMatchObject({ kind: 'not_found' });
  });
});

describe('video_sessions et contexte prestataire', () => {
  it("contexte : filtre sur doctor_id, null si pas le prestataire ou salle au format invalide", async () => {
    mockResponses = [{ data: { id: 'c1', scheduled_at: 'S', started_at: null }, error: null }];
    expect(await getProviderCallContext('room-1', 'd1')).toEqual({ consultationId: 'c1', scheduledAt: 'S', startedAt: null });
    expect(opsOf(0, 'eq')).toEqual([['doctor_id', 'd1']]);
    mockResponses = [{ data: null, error: null }];
    expect(await getProviderCallContext('room-1', 'd1')).toBeNull();
    expect(await getProviderCallContext('a,b)', 'd1')).toBeNull();
  });

  it('insert au début, update ended_at + durée à la fin', async () => {
    mockResponses = [{ data: { id: 's1' }, error: null }, { data: null, error: null }];
    const id = await logVideoSessionStart({ consultationId: 'c1', roomName: 'app/room', initiatedBy: 'd1' });
    expect(id).toBe('s1');
    expect(opsOf(0, 'insert')[0][0]).toMatchObject({ consultation_id: 'c1', video_provider: 'jitsi', initiated_by: 'd1' });
    await logVideoSessionEnd('s1', 61.4);
    expect(opsOf(1, 'update')[0][0]).toMatchObject({ duration_seconds: 61 });
    expect(opsOf(1, 'eq')).toEqual([['id', 's1']]);
  });
});

describe('getPatientJoinedAt', () => {
  it('valeur présente, null, ou null sur erreur (colonne absente)', async () => {
    mockResponses = [{ data: { patient_joined_at: '2026-11-20T10:01:00Z' }, error: null }];
    expect(await getPatientJoinedAt('c1')).toBe('2026-11-20T10:01:00Z');
    expect(opsOf(0, 'eq')).toEqual([['id', 'c1']]);
    mockResponses = [{ data: { patient_joined_at: null }, error: null }];
    expect(await getPatientJoinedAt('c1')).toBeNull();
    mockResponses = [{ data: null, error: { code: '42703', message: 'column does not exist' } }];
    expect(await getPatientJoinedAt('c1')).toBeNull();
  });
});

describe('patient absent et notification', () => {
  it("status no_show filtré sur le prestataire ; refus du serveur traduit", async () => {
    mockResponses = [{ data: [{ id: 'c1' }], error: null }];
    await markPatientAbsent('c1', 'd1');
    expect(opsOf(0, 'update')[0][0]).toEqual({ status: 'no_show' });
    expect(opsOf(0, 'eq')).toEqual([['id', 'c1'], ['doctor_id', 'd1']]);
    mockResponses = [{ data: null, error: { code: 'P0001', message: "no_show impossible avant 15 minutes d'attente (disponible à X)" } }];
    await expect(markPatientAbsent('c1', 'd1')).rejects.toMatchObject({ kind: 'no_show_too_early' });
    mockResponses = [{ data: null, error: { code: '42501', message: 'le patient a rejoint la consultation, no_show impossible' } }];
    await expect(markPatientAbsent('c1', 'd1')).rejects.toMatchObject({ kind: 'patient_joined' });
    mockResponses = [{ data: null, error: { code: '42501', message: 'autre refus' } }];
    await expect(markPatientAbsent('c1', 'd1')).rejects.toMatchObject({ kind: 'unavailable' });
    mockResponses = [{ data: null, error: { code: 'XX', message: 'autre' } }];
    await expect(markPatientAbsent('c1', 'd1')).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('notify-consultation-started avec { consultationId }, ne lève jamais', async () => {
    mockInvoke.mockResolvedValueOnce({ data: {}, error: null });
    await notifyConsultationStarted('c1');
    expect(mockInvoke).toHaveBeenCalledWith('notify-consultation-started', { body: { consultationId: 'c1' } });
    mockInvoke.mockRejectedValueOnce(new Error('x'));
    await expect(notifyConsultationStarted('c1')).resolves.toBeUndefined();
  });
});
