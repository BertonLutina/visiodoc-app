import { evaluateChildRecordAccess } from './childrenApi';
import { patientRoute } from '@/utils/patientRoute';

/** Chaîne de requête espionnée : chaque méthode renvoie la chaîne, `await` résout `result`. */
function chain(result: { data: unknown; error: unknown }) {
  const calls: Record<string, unknown[][]> = {};
  const q: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'then') return (resolve: (v: unknown) => unknown) => resolve(result);
        return (...args: unknown[]) => {
          (calls[prop] ||= []).push(args);
          return q;
        };
      },
    },
  );
  return { q, calls };
}

const load = () => require('./providerApi');

afterEach(() => {
  jest.dontMock('@/lib/supabase');
  jest.resetModules();
});

describe('Mes patients : une ligne par enfant, jamais fondue dans celle du parent', () => {
  const parent = { id: 'par-1', first_name: 'Marie', last_name: 'Konaté', date_of_birth: '1985-03-02', gender: 'female' };
  const child = (id: string, first: string) => ({
    id,
    first_name: first,
    last_name: 'Konaté',
    date_of_birth: '2019-01-01',
    gender: 'male',
  });

  it('crée une ligne par enfant et une ligne pour le parent, avec l’âge et le genre de chaque personne', () => {
    const { groupPatientRows } = load();
    const rows = groupPatientRows([
      { patient: parent, reason: 'Fièvre', child_id: 'c1', child: child('c1', 'Léa') },
      { patient: parent, reason: 'Toux', child_id: 'c2', child: child('c2', 'Paul') },
      { patient: parent, reason: 'Suivi', child_id: null, child: null },
      { patient: parent, reason: 'Fièvre (2e)', child_id: 'c1', child: child('c1', 'Léa') },
    ]);
    expect(rows).toHaveLength(3);
    const lea = rows.find((r: any) => r.childId === 'c1');
    expect(lea).toMatchObject({ firstName: 'Léa', parentName: 'Marie Konaté', patientId: 'par-1', gender: 'male' });
    expect(lea.age).toBeLessThan(18); // âge de l'enfant, pas celui du parent
    const adult = rows.find((r: any) => r.childId === null);
    expect(adult).toMatchObject({ id: 'par-1', firstName: 'Marie', gender: 'female' });
    expect(adult.age).toBeGreaterThanOrEqual(18);
    expect(adult.parentName).toBeUndefined();
  });

  it('une ligne d’enfant ouvre la fiche de l’enfant, une ligne d’adulte celle du patient', () => {
    expect(patientRoute({ id: 'c1', patientId: 'par-1', childId: 'c1' })).toBe('/patient/par-1?childId=c1');
    expect(patientRoute({ id: 'par-1', patientId: 'par-1', childId: null })).toBe('/patient/par-1');
    expect(patientRoute({ id: 'p9' })).toBe('/patient/p9');
  });
});

describe('Consultation d’un enfant côté prestataire', () => {
  it('affiche l’enfant (âge de l’enfant) et garde le parent comme patient du compte', () => {
    const { mapConsultation } = load();
    const c = mapConsultation({
      id: 'k1',
      patient_id: 'par-1',
      patient: { id: 'par-1', first_name: 'Marie', last_name: 'Konaté' },
      child_id: 'c1',
      child: { id: 'c1', first_name: 'Léa', last_name: 'Konaté', date_of_birth: '2019-01-01', gender: 'female' },
      scheduled_at: '2099-01-01T09:00:00Z',
      status: 'scheduled',
    });
    expect(c.child).toMatchObject({ id: 'c1', firstName: 'Léa', gender: 'female' });
    expect(c.child.ageYears).toBeLessThan(18);
    expect(c.patient.firstName).toBe('Marie');
  });

  it('pas d’enfant pour une consultation ordinaire', () => {
    const { mapConsultation } = load();
    const c = mapConsultation({ id: 'k2', patient_id: 'p', scheduled_at: '2099-01-01T09:00:00Z', status: 'scheduled' });
    expect(c.child).toBeUndefined();
  });
});

describe('Dossier par personne (jamais mélangé)', () => {
  it('relevés du parent seul : child_id IS NULL ; d’un enfant : child_id = enfant', async () => {
    const { q, calls } = chain({ data: [], error: null });
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: () => ({ select: () => q }) }, supabasePublic: null, supabaseConfigured: true }));
    const { getMedicalRecords } = require('./patientApi');
    await getMedicalRecords('par-1', { childId: null });
    expect(calls.is).toEqual([['child_id', null]]);
    expect(calls.eq).toEqual([['patient_id', 'par-1']]);

    const second = chain({ data: [], error: null });
    jest.resetModules();
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: () => ({ select: () => second.q }) }, supabasePublic: null, supabaseConfigured: true }));
    await require('./patientApi').getMedicalRecords('par-1', { childId: 'c1' });
    expect(second.calls.eq).toEqual([['patient_id', 'par-1'], ['child_id', 'c1']]);
    expect(second.calls.is).toBeUndefined();
  });

  it('lit child_id sur le relevé : vide = le parent', () => {
    const { mapMedicalRecordRow } = require('./patientApi');
    const base = { id: 'r', patient_id: 'p', doctor_id: 'd', record_type: 'note', created_at: '2026-01-01T00:00:00Z' };
    expect(mapMedicalRecordRow(base).childId).toBeUndefined();
    expect(mapMedicalRecordRow({ ...base, child_id: 'c1' }).childId).toBe('c1');
  });

  it('historique de consultations par personne', async () => {
    const { q, calls } = chain({ data: [], error: null });
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: () => ({ select: () => q }) }, supabasePublic: null, supabaseConfigured: true }));
    const { getPatientConsultationHistory } = load();
    await getPatientConsultationHistory('doc-1', 'par-1', { childId: 'c1' });
    expect(calls.eq).toEqual([['doctor_id', 'doc-1'], ['patient_id', 'par-1'], ['child_id', 'c1']]);
  });

  it('le dernier relevé d’un prestataire est rangé par enfant, sinon par patient', async () => {
    const rows = [
      { id: '1', patient_id: 'par-1', child_id: 'c1', record_type: 'note', title: 'Enfant', created_at: '2026-02-01T00:00:00Z' },
      { id: '2', patient_id: 'par-1', child_id: null, record_type: 'note', title: 'Parent', created_at: '2026-01-01T00:00:00Z' },
    ];
    const { q } = chain({ data: rows, error: null });
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: () => ({ select: () => q }) }, supabasePublic: null, supabaseConfigured: true }));
    const map = await load().getLatestRecordByPatient('doc-1');
    expect(map.get('c1').title).toBe('Enfant');
    expect(map.get('par-1').title).toBe('Parent');
  });

  it('un relevé de consultation d’enfant est créé avec child_id ; sans enfant, le champ est absent', async () => {
    jest.doMock('./auditLog', () => ({ logMedicalRecordEvent: jest.fn().mockResolvedValue(undefined) }));
    const insert = jest.fn(() => ({ select: () => ({ single: async () => ({ data: { id: 'r1' }, error: null }) }) }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: () => ({ insert }) }, supabasePublic: null, supabaseConfigured: true }));
    const { createMedicalRecord } = load();
    await createMedicalRecord({ patientId: 'par-1', doctorId: 'd', kind: 'note', title: 'T', childId: 'c1' });
    await createMedicalRecord({ patientId: 'par-1', doctorId: 'd', kind: 'note', title: 'T' });
    expect((insert.mock.calls as any[][])[0][0]).toMatchObject({ child_id: 'c1', patient_id: 'par-1' });
    expect(Object.keys((insert.mock.calls as any[][])[1][0])).not.toContain('child_id');
    jest.dontMock('./auditLog');
  });

  it('accès retiré par le parent : prévaut sur la consultation ; sans ligne, accès automatique', () => {
    const now = new Date('2026-11-18T10:00:00Z');
    expect(evaluateChildRecordAccess(null, now)).toEqual({ hasAccess: true, isRevoked: false });
    expect(evaluateChildRecordAccess({ consent_status: 'revoked' }, now)).toEqual({ hasAccess: false, isRevoked: true });
    expect(evaluateChildRecordAccess({ consent_status: 'granted', expires_at: '2026-11-01T00:00:00Z' }, now)).toEqual({
      hasAccess: false,
      isRevoked: true,
    });
    expect(evaluateChildRecordAccess({ consent_status: 'granted', expires_at: null }, now)).toEqual({ hasAccess: true, isRevoked: false });
  });
});

describe('MOB-1711-1 : question « enfants » du prestataire', () => {
  it('posée seulement si accepts_children est vide ET « Ne plus afficher » est faux', () => {
    const { shouldShowAcceptsChildrenPrompt } = load();
    expect(shouldShowAcceptsChildrenPrompt({ acceptsChildren: null, hidePrompt: false })).toBe(true);
    expect(shouldShowAcceptsChildrenPrompt({ acceptsChildren: null, hidePrompt: true })).toBe(false);
    expect(shouldShowAcceptsChildrenPrompt({ acceptsChildren: true, hidePrompt: false })).toBe(false);
    expect(shouldShowAcceptsChildrenPrompt({ acceptsChildren: false, hidePrompt: false })).toBe(false);
    expect(shouldShowAcceptsChildrenPrompt(null)).toBe(false);
  });

  it('lit accepts_children et hide_accepts_children_prompt (colonne absente = false)', () => {
    const { mapAcceptsChildrenRow } = load();
    expect(mapAcceptsChildrenRow({ accepts_children: null, hide_accepts_children_prompt: false })).toEqual({
      acceptsChildren: null,
      hidePrompt: false,
    });
    expect(mapAcceptsChildrenRow({ accepts_children: true })).toEqual({ acceptsChildren: true, hidePrompt: false });
    expect(mapAcceptsChildrenRow({ accepts_children: false, hide_accepts_children_prompt: true })).toEqual({
      acceptsChildren: false,
      hidePrompt: true,
    });
    expect(mapAcceptsChildrenRow(null)).toEqual({ acceptsChildren: null, hidePrompt: false });
  });

  it('écrit sur SA ligne (user_id) : accepts_children, puis hide_accepts_children_prompt = true', async () => {
    const eq = jest.fn().mockResolvedValue({ error: null });
    const update = jest.fn(() => ({ eq }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: jest.fn(() => ({ update })) }, supabasePublic: null, supabaseConfigured: true }));
    const { setAcceptsChildren, hideAcceptsChildrenPrompt } = load();
    await setAcceptsChildren('u1', true);
    await hideAcceptsChildrenPrompt('u1');
    expect(update).toHaveBeenNthCalledWith(1, { accepts_children: true });
    expect(update).toHaveBeenNthCalledWith(2, { hide_accepts_children_prompt: true });
    expect(eq).toHaveBeenCalledWith('user_id', 'u1');
  });
});
