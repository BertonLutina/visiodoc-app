import {
  buildPatientsRow,
  completePhoneIdentity,
  needsPhoneIdentity,
  phoneIdentityIssue,
  type PhoneIdentityInput,
} from './patientIdentity';
import { setCurrentLangCode } from '@/i18n/core';

const mockUpdate = jest.fn();
const mockEq = jest.fn();
const mockSelect = jest.fn();
const mockUpsert = jest.fn();
const mockRpc = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabaseConfigured: true,
  supabase: {
    from: (...a: unknown[]) => mockFrom(...a),
    rpc: (...a: unknown[]) => mockRpc(...a),
  },
}));

const input: PhoneIdentityInput = {
  firstName: ' Fatou ',
  lastName: 'Kalala',
  gender: 'female',
  dateOfBirth: '1990-06-15',
  city: ' Matadi ',
  commune: '',
  healthConsent: true,
};

beforeEach(() => {
  setCurrentLangCode('fr');
  [mockUpdate, mockEq, mockSelect, mockUpsert, mockRpc, mockFrom].forEach((m) => m.mockReset());
  mockSelect.mockResolvedValue({ data: [{ id: 'u1' }], error: null });
  mockEq.mockReturnValue({ select: mockSelect });
  mockUpdate.mockReturnValue({ eq: mockEq });
  mockUpsert.mockResolvedValue({ error: null });
  mockRpc.mockResolvedValue({ data: null, error: null });
  mockFrom.mockImplementation((table: string) =>
    table === 'users' ? { update: mockUpdate } : { upsert: mockUpsert },
  );
});

describe('needsPhoneIdentity', () => {
  it('is true only for a patient without a last name', () => {
    expect(needsPhoneIdentity({ role: 'patient', lastName: '' })).toBe(true);
    expect(needsPhoneIdentity({ role: 'patient', lastName: 'Kalala' })).toBe(false);
    expect(needsPhoneIdentity({ role: 'provider', lastName: '' })).toBe(false);
    expect(needsPhoneIdentity(null)).toBe(false);
  });
});

describe('phoneIdentityIssue (MOB-1211-1 §2)', () => {
  it('requires the date of birth and 18 completed years', () => {
    expect(phoneIdentityIssue({ ...input, dateOfBirth: '' })).toBe('La date de naissance est obligatoire.');
    const minor = `${new Date().getFullYear() - 5}-01-01`;
    expect(phoneIdentityIssue({ ...input, dateOfBirth: minor })).toBe(
      'Vous devez avoir au moins 18 ans révolus pour vous inscrire.',
    );
    expect(phoneIdentityIssue(input)).toBeNull();
  });

  it('requires the gender, once, and the names', () => {
    expect(phoneIdentityIssue({ ...input, gender: null })).toBe('Choisis ton genre : Masculin ou Féminin.');
    expect(phoneIdentityIssue({ ...input, lastName: ' ' })).toBe(
      'Le nom est obligatoire, ainsi que le prénom ou le post-nom.',
    );
  });

  it('accepts a post-nom instead of a first name, but never without the last name', () => {
    expect(phoneIdentityIssue({ ...input, firstName: '', postNom: 'Mbala' })).toBeNull();
    expect(phoneIdentityIssue({ ...input, firstName: 'Fatou', postNom: 'Mbala' })).toBeNull();
    expect(phoneIdentityIssue({ ...input, firstName: '', postNom: '' })).toBe(
      'Le nom est obligatoire, ainsi que le prénom ou le post-nom.',
    );
    expect(phoneIdentityIssue({ ...input, lastName: '', postNom: 'Mbala' })).not.toBeNull();
  });

  it('requires the city (commune stays optional)', () => {
    expect(phoneIdentityIssue({ ...input, city: '  ' })).toBe('La ville est obligatoire.');
    expect(phoneIdentityIssue({ ...input, city: undefined })).toBe('La ville est obligatoire.');
    expect(phoneIdentityIssue({ ...input, commune: '' })).toBeNull();
  });
});

describe('completePhoneIdentity', () => {
  it('writes the gender once and reuses it in users and patients, city/commune optional', async () => {
    await completePhoneIdentity('user-1', input);
    const userPatch = mockUpdate.mock.calls[0][0];
    expect(userPatch).toMatchObject({ first_name: 'Fatou', last_name: 'Kalala', gender: 'female' });
    expect(Object.keys(userPatch)).not.toContain('avatar_url');
    expect(mockEq).toHaveBeenCalledWith('id', 'user-1');
    expect(mockUpsert).toHaveBeenCalledWith(
      { user_id: 'user-1', date_of_birth: '1990-06-15', gender: 'female', city: 'Matadi', commune: null, country: 'RDC' },
      { onConflict: 'user_id' },
    );
  });

  it('writes post_nom in the own users row (null when empty)', async () => {
    await completePhoneIdentity('user-1', { ...input, firstName: '', postNom: ' Mbala ' });
    expect(mockUpdate.mock.calls[0][0]).toMatchObject({ first_name: '', last_name: 'Kalala', post_nom: 'Mbala' });
    mockUpdate.mockClear();
    await completePhoneIdentity('user-1', { ...input, postNom: '  ' });
    expect(mockUpdate.mock.calls[0][0].post_nom).toBeNull();
  });

  it('refuses an empty city before any network call', async () => {
    await expect(completePhoneIdentity('user-1', { ...input, city: '' })).rejects.toThrow('La ville est obligatoire.');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('refuses a minor before any network call', async () => {
    const minor = `${new Date().getFullYear() - 5}-01-01`;
    await expect(completePhoneIdentity('user-1', { ...input, dateOfBirth: minor })).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('does not fail when recording a new city fails', async () => {
    mockRpc.mockImplementation((name: string) =>
      name === 'record_legal_acceptance'
        ? Promise.resolve({ data: 'id', error: null })
        : Promise.reject(new Error('rpc down')),
    );
    await expect(completePhoneIdentity('user-1', input)).resolves.toBeUndefined();
  });
});

describe('completePhoneIdentity : preuve légale (MOB-1811-6)', () => {
  it('refuses without the health consent before any network call', async () => {
    await expect(completePhoneIdentity('user-1', { ...input, healthConsent: false })).rejects.toThrow(
      'Le consentement au traitement des données de santé est obligatoire pour créer un compte patient.',
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('records cgu_patient, privacy and health_consent with the signup context on mobile', async () => {
    await completePhoneIdentity('user-1', input);
    const calls = mockRpc.mock.calls.filter((c) => c[0] === 'record_legal_acceptance').map((c) => c[1]);
    expect(calls).toEqual([
      { p_document: 'cgu_patient', p_version: 'CGU-PATIENT-v2', p_context: 'signup', p_platform: 'mobile' },
      { p_document: 'privacy', p_version: 'CONFID-v2', p_context: 'signup', p_platform: 'mobile' },
      { p_document: 'health_consent', p_version: 'CONSENT-SANTE-v1', p_context: 'signup', p_platform: 'mobile' },
    ]);
  });

  it('blocks with a translated message when the proof cannot be recorded', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockRpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'secret internal text' } });
    await expect(completePhoneIdentity('user-1', input)).rejects.toThrow(
      "Ton acceptation n'a pas pu être enregistrée. Réessaie dans un instant.",
    );
    expect(warn).toHaveBeenCalledWith('[legal:record] XX000');
    warn.mockRestore();
  });
});

describe('buildPatientsRow', () => {
  it('maps empty city and commune to null', () => {
    expect(buildPatientsRow('u', { ...input, city: '', commune: undefined })).toMatchObject({ city: null, commune: null });
  });
});

describe('completePhoneIdentity : aucune ligne users mise à jour', () => {
  it('refuse un succès silencieux quand la mise à jour ne touche aucune ligne', async () => {
    mockSelect.mockResolvedValue({ data: [], error: null });
    await expect(completePhoneIdentity('user-1', input)).rejects.toThrow(
      "Ton profil n'a pas pu être enregistré. Réessaie dans un instant.",
    );
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe('completePhoneIdentity : patient mineur refusé par la base (MOB-1711-3)', () => {
  it('affiche le message des 18 ans quand le trigger renvoie PATIENT_MUST_BE_ADULT', async () => {
    mockUpsert.mockResolvedValue({
      error: { code: '23514', message: 'PATIENT_MUST_BE_ADULT', details: null },
    });
    await expect(completePhoneIdentity('user-1', input)).rejects.toThrow(
      'Vous devez avoir au moins 18 ans révolus pour vous inscrire.',
    );
  });
});

describe('completePhoneIdentity : pays non ouvert (COUNTRY_NOT_OPEN, 23514)', () => {
  const message = "Visiodoc n'est pas encore disponible dans ce pays.";

  it('traduit COUNTRY_NOT_OPEN renvoyé par la mise à jour de users', async () => {
    mockSelect.mockResolvedValue({ data: null, error: { code: '23514', message: 'COUNTRY_NOT_OPEN', details: null } });
    await expect(completePhoneIdentity('user-1', input)).rejects.toThrow(message);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('traduit COUNTRY_NOT_OPEN renvoyé par la ligne patients', async () => {
    mockUpsert.mockResolvedValue({ error: { code: '23514', message: 'COUNTRY_NOT_OPEN', details: null } });
    await expect(completePhoneIdentity('user-1', input)).rejects.toThrow(message);
  });
});
