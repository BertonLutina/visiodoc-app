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
    expect(phoneIdentityIssue({ ...input, lastName: ' ' })).toBe('Le nom et le prénom sont obligatoires.');
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

  it('refuses a minor before any network call', async () => {
    const minor = `${new Date().getFullYear() - 5}-01-01`;
    await expect(completePhoneIdentity('user-1', { ...input, dateOfBirth: minor })).rejects.toThrow();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('does not fail when recording a new city fails', async () => {
    mockRpc.mockRejectedValue(new Error('rpc down'));
    await expect(completePhoneIdentity('user-1', input)).resolves.toBeUndefined();
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
