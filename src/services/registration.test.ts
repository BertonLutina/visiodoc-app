import {
  buildRegisterPrestaBody,
  resolveSpecialty,
  genderLabel,
  normalizeGender,
  registerPatientAccount,
  resendEmailConfirmation,
  resendCooldownRemaining,
  registerPatientErrorMessage,
  RegisterPatientError,
  RESEND_COOLDOWN_SECONDS,
  setLoginCredentials,
  submitLoginCredentials,
  LoginCredentialsError,
  loginCredentialsErrorMessage,
  needsLoginCredentials,
  shouldAskLoginCredentials,
  requireLoginCredentialsStep,
  markCodeSent,
  codeCooldownRemaining,
  resetCodeCooldowns,
} from './registration';
import {
  hasSubmittedCredentials,
  markCredentialsSubmitted,
  hasCredentialsPending,
  markCredentialsPending,
  clearCredentialsPending,
  pendingCredentialsUserIds,
  shouldDropOnRestore,
} from './loginCredentialsFlag';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authErrorMessage, edgeFunctionError, isEmailNotConfirmed } from '@/utils/authError';
import { isSessionExpiry } from '@/services/sessionExpiry';
import { setCurrentLangCode } from '@/i18n/core';

// Seule frontière simulée : `@/lib/supabase` (Edge Functions + garde-fous auth / users).
const mockInvoke = jest.fn();
const mockSignUp = jest.fn();
const mockSignIn = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabaseConfigured: true,
  supabase: {
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    auth: {
      signUp: (...a: unknown[]) => mockSignUp(...a),
      signInWithPassword: (...a: unknown[]) => mockSignIn(...a),
    },
    from: (...a: unknown[]) => mockFrom(...a),
  },
  supabasePublic: null,
}));

/** Erreur telle que la renvoie supabase-js : FunctionsHttpError avec la `Response` dans `context`. */
const httpError = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  name: 'FunctionsHttpError',
  message: 'Edge Function returned a non-2xx status code',
  context: new Response(JSON.stringify(body), { status, headers }),
});

// Valeurs du guide « Inscription Prestataire » (POST /functions/v1/register-presta).
const baseInput = {
  email: '  Docteur.Test@Exemple.com ',
  password: 'MotDePasseSecurise123!',
  firstName: 'Jean',
  lastName: 'Kabasele',
  gender: 'female' as string | null | undefined,
  phone: '+243810000001',
  serviceTypeId: '4f0c2d3a-1b2c-4d5e-8f90-123456789abc' as string | null,
  proposedSpecialtyLabel: null as string | null,
  countryId: '8a1b2c3d-0000-4000-8000-00000000cd01',
  city: 'Kinshasa',
  licenseNumber: 'CNOM/2026/8841',
};

describe('buildRegisterPrestaBody', () => {
  it('omits the phone key when the number is empty, keeps it when filled', () => {
    expect(buildRegisterPrestaBody({ ...baseInput, phone: '' })).not.toHaveProperty('phone');
    expect(buildRegisterPrestaBody({ ...baseInput, phone: undefined })).not.toHaveProperty('phone');
    expect(buildRegisterPrestaBody({ ...baseInput, phone: '0899999999', countryCode: 'CD' }).phone).toBe('+243899999999');
  });

  it('produces exactly the body of the guide, with gender and serviceTypeId', () => {
    expect(buildRegisterPrestaBody(baseInput)).toEqual({
      email: 'docteur.test@exemple.com',
      password: 'MotDePasseSecurise123!',
      firstName: 'Jean',
      lastName: 'Kabasele',
      gender: 'female',
      phone: '+243810000001',
      serviceTypeId: '4f0c2d3a-1b2c-4d5e-8f90-123456789abc',
      proposedSpecialtyLabel: null,
      countryId: '8a1b2c3d-0000-4000-8000-00000000cd01',
      city: 'Kinshasa',
      licenseNumber: 'CNOM/2026/8841',
      legalAcceptance: { cguVersion: 'CGU-PRO-v2', privacyVersion: 'CONFID-v2', platform: 'mobile' },
    });
  });

  it('never carries a free-text `specialization` key nor the value "other"', () => {
    const body = buildRegisterPrestaBody({ ...baseInput, specialization: 'Cardiologie' } as typeof baseInput);
    expect(Object.keys(body)).not.toContain('specialization');
    expect(JSON.stringify(body)).not.toContain('other');
  });

  it('sends a proposed specialty label (and no serviceTypeId) for a specialty outside the catalog', () => {
    const body = buildRegisterPrestaBody({
      ...baseInput,
      serviceTypeId: null,
      proposedSpecialtyLabel: ' Médecine du sport ',
    });
    expect(body.serviceTypeId).toBeNull();
    expect(body.proposedSpecialtyLabel).toBe('Médecine du sport');
  });

  it('accepts male', () => {
    expect(buildRegisterPrestaBody({ ...baseInput, gender: 'male' }).gender).toBe('male');
  });

  it.each([
    ['0810000001', '+243810000001'],
    ['+243 81 000 0001', '+243810000001'],
    ['00243810000001', '+243810000001'],
  ])('sends the provider phone %s as %s', (typed, sent) => {
    expect(buildRegisterPrestaBody({ ...baseInput, phone: typed, countryCode: 'CD' }).phone).toBe(sent);
  });

  it('omits the provider phone when blank', () => {
    expect(buildRegisterPrestaBody({ ...baseInput, phone: '  ', countryCode: 'CD' }).phone).toBeUndefined();
    expect(buildRegisterPrestaBody({ ...baseInput, phone: undefined, countryCode: 'CD' }).phone).toBeUndefined();
  });

  it("throws before any network call when gender is 'other'", () => {
    expect(() => buildRegisterPrestaBody({ ...baseInput, gender: 'other' })).toThrow();
  });

  it('throws when gender is missing or empty', () => {
    expect(() => buildRegisterPrestaBody({ ...baseInput, gender: undefined })).toThrow();
    expect(() => buildRegisterPrestaBody({ ...baseInput, gender: null })).toThrow();
    expect(() => buildRegisterPrestaBody({ ...baseInput, gender: '' })).toThrow();
  });
});

describe('resolveSpecialty', () => {
  const catalog = [
    { id: 'uuid-cardio', label: 'Cardiologie' },
    { id: 'uuid-mg', label: 'Médecine générale' },
  ];

  it('returns the service_types id for an official specialty (accent/case tolerant)', () => {
    expect(resolveSpecialty('medecine generale', catalog)).toEqual({
      serviceTypeId: 'uuid-mg',
      proposedSpecialtyLabel: null,
    });
  });

  it('proposes the label when the specialty is not in the catalog', () => {
    expect(resolveSpecialty('  Médecine du sport ', catalog)).toEqual({
      serviceTypeId: null,
      proposedSpecialtyLabel: 'Médecine du sport',
    });
  });

  it('proposes the label when the catalog could not be read', () => {
    expect(resolveSpecialty('Cardiologie', [])).toEqual({
      serviceTypeId: null,
      proposedSpecialtyLabel: 'Cardiologie',
    });
  });
});

describe('edgeFunctionError (register-presta 422 weak_password)', () => {
  it('keeps error_code and reasons so the pwned message is recognised', () => {
    const e = edgeFunctionError({
      error: 'Password is known to be weak',
      error_code: 'weak_password',
      reasons: ['pwned'],
    });
    expect(e.message).toBe('Password is known to be weak');
    expect(authErrorMessage(e)).toBe('Ce mot de passe a déjà fuité sur Internet, choisis-en un autre.');
  });

  it('does not turn a length-only weak_password into the pwned message', () => {
    const e = edgeFunctionError({ error: 'Password too short', error_code: 'weak_password', reasons: ['length'] });
    expect(authErrorMessage(e)).toBe('Password too short');
  });

  it('falls back to the fallback message when the body has none', () => {
    expect(edgeFunctionError(null, 'Edge Function returned a non-2xx status code').message).toBe(
      'Edge Function returned a non-2xx status code',
    );
  });
});

describe('normalizeGender (users.gender → male | female | null)', () => {
  it('passes male and female through', () => {
    expect(normalizeGender('male')).toBe('male');
    expect(normalizeGender('female')).toBe('female');
  });

  it('maps legacy / unexpected values and absence to null', () => {
    expect(normalizeGender('other')).toBeNull();
    expect(normalizeGender('M')).toBeNull();
    expect(normalizeGender('F')).toBeNull();
    expect(normalizeGender('')).toBeNull();
    expect(normalizeGender(null)).toBeNull();
    expect(normalizeGender(undefined)).toBeNull();
  });
});

describe('genderLabel', () => {
  it('shows the French labels of the guide', () => {
    expect(genderLabel('male')).toBe('Masculin');
    expect(genderLabel('female')).toBe('Féminin');
  });

  it("shows 'Non renseigné' for null, never raw English text for a legacy value", () => {
    expect(genderLabel(null)).toBe('Non renseigné');
    expect(genderLabel(undefined)).toBe('Non renseigné');
    expect(genderLabel('other')).toBe('Non renseigné');
  });
});

describe('edgeFunctionError with a non-string error', () => {
  it('never produces an empty message', () => {
    expect(edgeFunctionError({ error: { code: 1 } }, 'Edge Function returned a non-2xx status code').message).toBe(
      'Edge Function returned a non-2xx status code',
    );
    expect(edgeFunctionError({ error: true }).message).not.toBe('');
  });
});

// ---------------------------------------------------------------------------------------------
// MOB-0612-1 : inscription patient par `register-patient` + confirmation d'e-mail obligatoire
// ---------------------------------------------------------------------------------------------

const GUIDE_WEAK_PASSWORD = 'Le mot de passe doit comporter au moins 10 caractères et inclure au moins une lettre et un chiffre.';
const GUIDE_CONFLICT = 'Cette adresse e-mail ou ce numéro de téléphone est déjà associé à un compte.';
const GUIDE_EMAIL_FAILED = "Impossible d'envoyer l'e-mail de confirmation. Veuillez réessayer dans quelques instants.";
const CD_UUID = '5845fc2a-0579-4604-a4cd-adcc1dabab6c';
const NE_UUID = '602311ca-5958-4877-af57-65c44d7a3031';

const patientInput = {
  email: '  Patient@Example.com ',
  password: 'StrongPassword123!',
  firstName: 'Fatou',
  lastName: 'Kalala',
  gender: 'female' as string | null | undefined,
  phone: '+243899999999',
  countryCode: 'CD' as string | undefined,
  dateOfBirth: '1990-06-15',
  city: 'Kinshasa' as string | undefined,
  commune: undefined as string | undefined,
  postNom: undefined as string | undefined,
  healthConsent: true,
};

const okResponse = {
  data: {
    success: true,
    requiresEmailConfirmation: true,
    message: 'Un e-mail de confirmation vous a été envoyé. Veuillez cliquer sur le lien pour activer votre compte.',
  },
  error: null,
};

describe('registerPatientAccount', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockSignUp.mockReset();
    mockSignIn.mockReset();
    mockFrom.mockReset();
    mockInvoke.mockResolvedValue(okResponse);
    setCurrentLangCode('fr');
  });

  afterEach(() => setCurrentLangCode('fr'));

  it('invokes register-patient with exactly the body of the guide', async () => {
    await registerPatientAccount(patientInput);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('register-patient', {
      body: {
        email: 'patient@example.com',
        password: 'StrongPassword123!',
        firstName: 'Fatou',
        lastName: 'Kalala',
        gender: 'female',
        dateOfBirth: '1990-06-15',
        city: 'Kinshasa',
        phone: '+243899999999',
        language: 'fr',
        countryId: CD_UUID,
        legalAcceptance: {
          cguVersion: 'CGU-PATIENT-v2',
          privacyVersion: 'CONFID-v2',
          healthConsent: true,
          healthConsentVersion: 'CONSENT-SANTE-v1',
          platform: 'mobile',
        },
      },
    });
  });

  it('refuses without the health consent, before any network call', async () => {
    await expect(registerPatientAccount({ ...patientInput, healthConsent: false })).rejects.toThrow(
      'Le consentement au traitement des données de santé est obligatoire pour créer un compte patient.',
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it.each([
    ["Vous devez accepter les conditions d'utilisation.", 'You must accept the terms of use.'],
    [
      'Vous devez donner votre consentement au traitement de vos données de santé.',
      'You must give your consent to the processing of your health data.',
    ],
    ["Les informations d'acceptation des conditions sont invalides.", 'The terms acceptance information is invalid.'],
  ])('translates the legal 400 %s', async (serverText, english) => {
    setCurrentLangCode('en');
    mockInvoke.mockResolvedValue({ data: null, error: httpError(400, { error: serverText }) });
    await expect(registerPatientAccount(patientInput)).rejects.toThrow(english);
  });

  it('sends city and commune (trimmed), the commune only when filled in', async () => {
    await registerPatientAccount({ ...patientInput, city: '  Matadi ', commune: ' Nzanza' });
    const body = mockInvoke.mock.calls[0][1].body;
    expect(body.city).toBe('Matadi');
    expect(body.commune).toBe('Nzanza');
    mockInvoke.mockClear();
    await registerPatientAccount({ ...patientInput, commune: '' });
    expect(Object.keys(mockInvoke.mock.calls[0][1].body)).not.toContain('commune');
  });

  it('refuses an empty city before any network call', async () => {
    for (const city of ['', '   ', undefined]) {
      await expect(registerPatientAccount({ ...patientInput, city })).rejects.toThrow('La ville est obligatoire.');
    }
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('applies the names rule and sends a trimmed postNom (empty firstName accepted for DRC)', async () => {
    await expect(registerPatientAccount({ ...patientInput, lastName: ' ' })).rejects.toThrow(
      'Le nom est obligatoire, ainsi que le prénom ou le post-nom.',
    );
    await expect(registerPatientAccount({ ...patientInput, firstName: '', postNom: '  ' })).rejects.toThrow(
      'Le nom est obligatoire, ainsi que le prénom ou le post-nom.',
    );
    expect(mockInvoke).not.toHaveBeenCalled();
    await registerPatientAccount({ ...patientInput, postNom: ' Mbala ' });
    expect(mockInvoke.mock.calls[0][1].body.postNom).toBe('Mbala');
    mockInvoke.mockClear();
    await registerPatientAccount({ ...patientInput, firstName: '', postNom: 'Mbala' });
    expect(mockInvoke.mock.calls[0][1].body).toMatchObject({ firstName: '', postNom: 'Mbala' });
    mockInvoke.mockClear();
    await registerPatientAccount({ ...patientInput, postNom: '   ' });
    expect(Object.keys(mockInvoke.mock.calls[0][1].body)).not.toContain('postNom');
  });

  it.each([
    ['Champ obligatoire.', 'Un champ obligatoire est manquant. Vérifie le formulaire.'],
    ['Le prénom ou le post-nom est obligatoire.', 'Le prénom ou le post-nom est obligatoire.'],
    ["Visiodoc n'est pas encore disponible dans ce pays.", "Visiodoc n'est pas encore disponible dans ce pays."],
  ])('maps the server 400 "%s" to a translated message', async (serverText, expected) => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(400, { error: serverText }) });
    const err: RegisterPatientError = await registerPatientAccount(patientInput).catch((e) => e);
    expect(err.kind).toBe('validation');
    expect(registerPatientErrorMessage(err)).toBe(expected);
  });

  it('refuses a city or commune over 100 characters before any network call', async () => {
    await expect(registerPatientAccount({ ...patientInput, city: 'a'.repeat(101) })).rejects.toThrow();
    await expect(registerPatientAccount({ ...patientInput, commune: 'a'.repeat(101) })).rejects.toThrow();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('refuses a minor with the server wording, before any network call', async () => {
    const minor = `${new Date().getFullYear() - 10}-01-01`;
    await expect(registerPatientAccount({ ...patientInput, dateOfBirth: minor })).rejects.toThrow(
      'Vous devez avoir au moins 18 ans révolus pour vous inscrire.',
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('refuses a missing or malformed date of birth before any network call', async () => {
    await expect(registerPatientAccount({ ...patientInput, dateOfBirth: '' })).rejects.toThrow(
      'La date de naissance est obligatoire.',
    );
    await expect(registerPatientAccount({ ...patientInput, dateOfBirth: '15/06/1990' })).rejects.toThrow();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('maps a server 400 "Required" to a generic missing-field message', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(400, { error: 'Required' }) });
    const err: RegisterPatientError = await registerPatientAccount(patientInput).catch((e) => e);
    expect(err.kind).toBe('validation');
    expect(registerPatientErrorMessage(err)).toBe('Un champ obligatoire est manquant. Vérifie le formulaire.');
  });

  it('omits the phone key from the body when the number is empty (optional phone)', async () => {
    await registerPatientAccount({ ...patientInput, phone: '' });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke.mock.calls[0][1].body).not.toHaveProperty('phone');
  });

  it('omits the phone key when the phone is undefined, blank or zeros only', async () => {
    for (const phone of [undefined, '   ', '000']) {
      mockInvoke.mockClear();
      await registerPatientAccount({ ...patientInput, phone });
      expect(mockInvoke.mock.calls[0][1].body).not.toHaveProperty('phone');
    }
  });

  it('keeps sending the phone in E.164 when it is filled', async () => {
    await registerPatientAccount({ ...patientInput, phone: '0899999999', countryCode: 'CD' });
    expect(mockInvoke.mock.calls[0][1].body.phone).toBe('+243899999999');
  });

  it('keeps the server age refusal text', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(400, { error: 'Vous devez avoir au moins 18 ans révolus pour vous inscrire.' }),
    });
    const err: RegisterPatientError = await registerPatientAccount(patientInput).catch((e) => e);
    expect(registerPatientErrorMessage(err)).toBe('Vous devez avoir au moins 18 ans révolus pour vous inscrire.');
  });

  it('never calls auth.signUp / signInWithPassword and never touches the users table', async () => {
    await registerPatientAccount(patientInput);
    expect(mockSignUp).not.toHaveBeenCalled();
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('resolves { requiresEmailConfirmation: true } on a 200 and creates no session', async () => {
    await expect(registerPatientAccount(patientInput)).resolves.toEqual({ requiresEmailConfirmation: true });
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('sends the UUID of the chosen country: Niger when NE is chosen', async () => {
    await registerPatientAccount({ ...patientInput, countryCode: 'NE' });
    expect(mockInvoke.mock.calls[0][1].body.countryId).toBe(NE_UUID);
  });

  it('the phone dialling code does not change the countryId sent (Belgian number, DRC Visiodoc)', async () => {
    await registerPatientAccount({ ...patientInput, countryCode: 'CD', phone: '+32475123456' });
    const body = mockInvoke.mock.calls[0][1].body;
    expect(body.phone).toBe('+32475123456');
    expect(body.countryId).toBe(CD_UUID);
  });

  it('omits countryId when the chosen code has no country UUID in the app config', async () => {
    await registerPatientAccount({ ...patientInput, countryCode: 'SN' });
    const body = mockInvoke.mock.calls[0][1].body;
    expect(Object.keys(body)).not.toContain('countryId');
  });

  it('omits countryId when no country was chosen', async () => {
    await registerPatientAccount({ ...patientInput, countryCode: undefined });
    expect(Object.keys(mockInvoke.mock.calls[0][1].body)).not.toContain('countryId');
  });

  it.each([
    ['0899999999', '+243899999999'],
    ['899999999', '+243899999999'],
    ['+243 899 999 999', '+243899999999'],
    ['00243899999999', '+243899999999'],
    ['+243899999999', '+243899999999'],
  ])('sends the phone %s as %s in the body (DRC)', async (typed, sent) => {
    await registerPatientAccount({ ...patientInput, phone: typed, countryCode: 'CD' });
    expect(mockInvoke.mock.calls[0][1].body.phone).toBe(sent);
  });

  it("uses the chosen country's dial code for a local phone (Niger)", async () => {
    await registerPatientAccount({ ...patientInput, phone: '90 12 34 56', countryCode: 'NE' });
    expect(mockInvoke.mock.calls[0][1].body.phone).toBe('+22790123456');
  });

  it('sends male as is', async () => {
    await registerPatientAccount({ ...patientInput, gender: 'male' });
    expect(mockInvoke.mock.calls[0][1].body.gender).toBe('male');
  });

  it("omits language when the app is not in French (the guide only documents 'fr')", async () => {
    setCurrentLangCode('en');
    await registerPatientAccount(patientInput);
    expect(Object.keys(mockInvoke.mock.calls[0][1].body)).not.toContain('language');
  });

  it("rejects gender 'other' before any network call", async () => {
    await expect(registerPatientAccount({ ...patientInput, gender: 'other' })).rejects.toThrow(
      'Choisis ton genre : Masculin ou Féminin.',
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('rejects a missing gender before any network call', async () => {
    await expect(registerPatientAccount({ ...patientInput, gender: undefined })).rejects.toThrow();
    await expect(registerPatientAccount({ ...patientInput, gender: null })).rejects.toThrow();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('400 → validation error carrying the server message as is', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(400, { error: GUIDE_WEAK_PASSWORD }) });
    const err: RegisterPatientError = await registerPatientAccount(patientInput).catch((e) => e);
    expect(err).toBeInstanceOf(RegisterPatientError);
    expect(err.kind).toBe('validation');
    expect(err.message).toBe(GUIDE_WEAK_PASSWORD);
    expect(registerPatientErrorMessage(err)).toBe(GUIDE_WEAK_PASSWORD);
  });

  it('422 weak_password + pwned → validation error that shows the pwned message', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(422, { error: 'Password is known to be weak', error_code: 'weak_password', reasons: ['pwned'] }),
    });
    const err: RegisterPatientError = await registerPatientAccount(patientInput).catch((e) => e);
    expect(err.kind).toBe('validation');
    expect(authErrorMessage(err)).toBe('Ce mot de passe a déjà fuité sur Internet, choisis-en un autre.');
    expect(registerPatientErrorMessage(err)).toBe('Ce mot de passe a déjà fuité sur Internet, choisis-en un autre.');
  });

  it('409 → conflict error carrying the server message', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(409, { error: GUIDE_CONFLICT }) });
    const err: RegisterPatientError = await registerPatientAccount(patientInput).catch((e) => e);
    expect(err.kind).toBe('conflict');
    expect(registerPatientErrorMessage(err)).toBe(GUIDE_CONFLICT);
  });

  it('409 phone already used → conflict with the translated phone message', async () => {
    const PHONE = 'Ce numéro de téléphone est déjà utilisé par un autre compte.';
    mockInvoke.mockResolvedValue({ data: null, error: httpError(409, { error: PHONE }) });
    const err: RegisterPatientError = await registerPatientAccount(patientInput).catch((e) => e);
    expect(err.kind).toBe('conflict');
    expect(registerPatientErrorMessage(err)).toBe(PHONE);
    setCurrentLangCode('en');
    mockInvoke.mockResolvedValue({ data: null, error: httpError(409, { error: PHONE }) });
    const errEn: RegisterPatientError = await registerPatientAccount(patientInput).catch((e) => e);
    expect(registerPatientErrorMessage(errEn)).toBe('This phone number is already used by another account.');
  });

  it('429 with Retry-After: 42 → rate_limited error and a message with 42 seconds', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(429, { error: 'Too many requests' }, { 'Retry-After': '42' }),
    });
    const err: RegisterPatientError = await registerPatientAccount(patientInput).catch((e) => e);
    expect(err.kind).toBe('rate_limited');
    expect(err.retryAfterSeconds).toBe(42);
    expect(registerPatientErrorMessage(err)).toBe("Trop d'essais. Réessaie dans 42 secondes.");
  });

  it('429 without Retry-After → rate_limited error with a generic message', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(429, { error: 'Too many requests' }) });
    const err: RegisterPatientError = await registerPatientAccount(patientInput).catch((e) => e);
    expect(err.kind).toBe('rate_limited');
    expect(err.retryAfterSeconds).toBeUndefined();
    expect(registerPatientErrorMessage(err)).toBe("Trop d'essais. Réessaie dans quelques minutes.");
  });

  it('502 → email_failed error with the server message (account not created, retry allowed)', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(502, { error: GUIDE_EMAIL_FAILED }) });
    const err: RegisterPatientError = await registerPatientAccount(patientInput).catch((e) => e);
    expect(err.kind).toBe('email_failed');
    expect(registerPatientErrorMessage(err)).toBe(GUIDE_EMAIL_FAILED);
  });

  it('network failure (no HTTP response) → unknown error with the SDK message', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' },
    });
    const err: RegisterPatientError = await registerPatientAccount(patientInput).catch((e) => e);
    expect(err.kind).toBe('unknown');
    expect(err.message).toBe('Failed to send a request to the Edge Function');
  });
});

describe('resendEmailConfirmation', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockFrom.mockReset();
    mockInvoke.mockResolvedValue({
      data: {
        success: true,
        message: "Si cette adresse est associée à un compte non confirmé, un nouveau lien de confirmation a été envoyé.",
      },
      error: null,
    });
    setCurrentLangCode('fr');
  });

  it('invokes resend-email-confirmation with { email, language }', async () => {
    await expect(resendEmailConfirmation(' Patient@Example.com ', 'fr')).resolves.toBeUndefined();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('resend-email-confirmation', {
      body: { email: 'patient@example.com', language: 'fr' },
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("defaults the language to the app's French", async () => {
    await resendEmailConfirmation('patient@example.com');
    expect(mockInvoke).toHaveBeenCalledWith('resend-email-confirmation', {
      body: { email: 'patient@example.com', language: 'fr' },
    });
  });

  it('429 → rate_limited error honouring Retry-After', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(429, { error: 'Too many requests' }, { 'Retry-After': '30' }),
    });
    const err: RegisterPatientError = await resendEmailConfirmation('patient@example.com').catch((e) => e);
    expect(err.kind).toBe('rate_limited');
    expect(err.retryAfterSeconds).toBe(30);
  });
});

describe('resendCooldownRemaining (60 s between two resends)', () => {
  it('uses the 60 seconds of the guide (étape 8.3)', () => {
    expect(RESEND_COOLDOWN_SECONDS).toBe(60);
  });

  it('is 0 when nothing was sent yet', () => {
    expect(resendCooldownRemaining(null, 5000)).toBe(0);
  });

  it('is 60 right after sending', () => {
    expect(resendCooldownRemaining(1000, 1000)).toBe(60);
  });

  it('counts down in whole seconds, rounded up', () => {
    expect(resendCooldownRemaining(1000, 31000)).toBe(30);
    expect(resendCooldownRemaining(1000, 60999)).toBe(1);
  });

  it('is 0 once 60 seconds have elapsed', () => {
    expect(resendCooldownRemaining(1000, 61000)).toBe(0);
    expect(resendCooldownRemaining(1000, 120000)).toBe(0);
  });

  it('never exceeds 60 if the clock goes backwards', () => {
    expect(resendCooldownRemaining(10000, 2000)).toBe(60);
  });
});

describe('isEmailNotConfirmed (GoTrue email_not_confirmed)', () => {
  it('recognises the GoTrue error code', () => {
    expect(isEmailNotConfirmed({ code: 'email_not_confirmed', message: 'x' })).toBe(true);
    expect(isEmailNotConfirmed({ error_code: 'email_not_confirmed' })).toBe(true);
  });

  it("recognises the message 'Email not confirmed' (any case)", () => {
    expect(isEmailNotConfirmed(new Error('Email not confirmed'))).toBe(true);
    expect(isEmailNotConfirmed({ message: 'EMAIL NOT CONFIRMED' })).toBe(true);
  });

  it('rejects other errors and empty values', () => {
    expect(isEmailNotConfirmed(new Error('Invalid login credentials'))).toBe(false);
    expect(isEmailNotConfirmed({ code: 'invalid_credentials' })).toBe(false);
    expect(isEmailNotConfirmed(null)).toBe(false);
    expect(isEmailNotConfirmed(undefined)).toBe(false);
  });

  it('is shown with the exact guide message through authErrorMessage', () => {
    expect(authErrorMessage(new Error('Email not confirmed'))).toBe(
      "Ton adresse e-mail n'est pas encore confirmée. Clique sur le lien reçu par e-mail.",
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Étape 8 : `set-login-credentials` après l'OTP WhatsApp (e-mail + mot de passe obligatoires).
// Corps d'erreur RÉELS de la fonction (backend ce92d3b) : `{ success: false, code, error }`.
// Succès : `{ success: true, pending: true, email }` (pas de `message`).
// ---------------------------------------------------------------------------------------------

const CREDENTIALS_OK = { success: true, pending: true, email: 'patient.recup@exemple.com' };
const GUIDE_EMAIL = 'patient.recup@exemple.com';
const GUIDE_PASSWORD = 'NouveauMotDePasse123!';
const SHARED_WEAK_PASSWORD =
  'Le mot de passe doit comporter au moins 10 caractères et inclure au moins une lettre et un chiffre.';

const run = (email = GUIDE_EMAIL, pw = GUIDE_PASSWORD, confirm = GUIDE_PASSWORD) =>
  setLoginCredentials(email, pw, confirm).catch((e) => e) as Promise<LoginCredentialsError>;

describe('setLoginCredentials', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockSignUp.mockReset();
    mockSignIn.mockReset();
    mockFrom.mockReset();
    mockInvoke.mockResolvedValue({ data: CREDENTIALS_OK, error: null });
    setCurrentLangCode('fr');
  });

  afterEach(() => setCurrentLangCode('fr'));

  it('invokes set-login-credentials with exactly { email, newPassword, confirmPassword } (no `password`)', async () => {
    await setLoginCredentials(GUIDE_EMAIL, GUIDE_PASSWORD, GUIDE_PASSWORD);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('set-login-credentials', {
      body: { email: GUIDE_EMAIL, newPassword: GUIDE_PASSWORD, confirmPassword: GUIDE_PASSWORD },
    });
    const body = mockInvoke.mock.calls[0][1].body;
    expect(Object.keys(body).sort()).toEqual(['confirmPassword', 'email', 'newPassword']);
    expect(Object.keys(body)).not.toContain('password');
  });

  it('trims and lowercases the e-mail but never touches the password', async () => {
    await setLoginCredentials('  Patient.Recup@Exemple.com ', 'Abcdefghij12', 'Abcdefghij12');
    expect(mockInvoke.mock.calls[0][1].body).toEqual({
      email: GUIDE_EMAIL,
      newPassword: 'Abcdefghij12',
      confirmPassword: 'Abcdefghij12',
    });
  });

  it('resolves the real success body: { success: true, pending: true, email } (no message)', async () => {
    await expect(setLoginCredentials(GUIDE_EMAIL, GUIDE_PASSWORD, GUIDE_PASSWORD)).resolves.toEqual({
      success: true,
      pending: true,
      email: GUIDE_EMAIL,
    });
  });

  it('newPassword !== confirmPassword → typed error, function NOT called', async () => {
    const err = await run(GUIDE_EMAIL, GUIDE_PASSWORD, 'AutreMotDePasse456');
    expect(err).toBeInstanceOf(LoginCredentialsError);
    expect(err.kind).toBe('password_mismatch');
    expect(err.message).toBe('Les mots de passe ne correspondent pas.');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it.each([
    ['short', 'Abc12345', 'Le mot de passe doit contenir au moins 10 caractères.'],
    ['no digit', 'AbcdefghijKL', 'Le mot de passe doit contenir au moins une lettre et un chiffre.'],
    ['no letter', '1234567890123', 'Le mot de passe doit contenir au moins une lettre et un chiffre.'],
    ['73 chars', `a1${'b'.repeat(71)}`, 'Le mot de passe ne doit pas dépasser 72 caractères.'],
  ])('weak password (%s) → typed error, function NOT called', async (_name, password, message) => {
    const err = await run(GUIDE_EMAIL, password, password);
    expect(err).toBeInstanceOf(LoginCredentialsError);
    expect(err.kind).toBe('weak_password');
    expect(err.message).toBe(message);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it.each(['', '   ', 'pas-un-email', 'a@b', 'a b@c.cd', '@exemple.com'])(
    'invalid e-mail %p → typed error, function NOT called',
    async (email) => {
      const err = await run(email);
      expect(err).toBeInstanceOf(LoginCredentialsError);
      expect(err.kind).toBe('invalid_email');
      expect(err.message).toBe('Adresse email invalide.');
      expect(mockInvoke).not.toHaveBeenCalled();
    },
  );

  it('accepts the 10-character and 72-character limits', async () => {
    await setLoginCredentials(GUIDE_EMAIL, 'abcdefghi1', 'abcdefghi1');
    const long = `a1${'b'.repeat(70)}`;
    expect(long).toHaveLength(72);
    await setLoginCredentials(GUIDE_EMAIL, long, long);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it('400 WEAK_PASSWORD without a server text → the shared weak-password message', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(400, { success: false, code: 'WEAK_PASSWORD' }) });
    const err = await run();
    expect(err.kind).toBe('weak_password');
    expect(loginCredentialsErrorMessage(err)).toBe(SHARED_WEAK_PASSWORD);
  });

  it('400 WEAK_PASSWORD → the server French text as is (blacklist, e-mail or name rules the client cannot know)', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(400, {
        success: false,
        code: 'WEAK_PASSWORD',
        error: 'Le mot de passe ne peut pas être identique à votre adresse e-mail.',
      }),
    });
    const err = await run();
    expect(err.kind).toBe('weak_password');
    expect(loginCredentialsErrorMessage(err)).toBe(
      'Le mot de passe ne peut pas être identique à votre adresse e-mail.',
    );
  });

  it('400 INVALID_EMAIL → the existing invalid e-mail message', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(400, { success: false, code: 'INVALID_EMAIL', error: 'Adresse e-mail invalide.' }),
    });
    const err = await run();
    expect(err.kind).toBe('invalid_email');
    expect(loginCredentialsErrorMessage(err)).toBe('Adresse email invalide.');
  });

  it('400 PASSWORD_MISMATCH → the mismatch message', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(400, {
        success: false,
        code: 'PASSWORD_MISMATCH',
        error: 'La confirmation ne correspond pas au mot de passe.',
      }),
    });
    const err = await run();
    expect(err.kind).toBe('password_mismatch');
    expect(loginCredentialsErrorMessage(err)).toBe('Les mots de passe ne correspondent pas.');
  });

  it('409 EMAIL_TAKEN → conflict: the existing "e-mail already used" message', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(409, { success: false, code: 'EMAIL_TAKEN', error: 'Cette adresse e-mail est déjà utilisée.' }),
    });
    const err = await run();
    expect(err.kind).toBe('conflict');
    expect(err.code).toBe('EMAIL_TAKEN');
    expect(loginCredentialsErrorMessage(err)).toBe('Un compte existe déjà avec cet email.');
  });

  it('409 ALREADY_HAS_LOGIN_EMAIL → dedicated kind and French message', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(409, {
        success: false,
        code: 'ALREADY_HAS_LOGIN_EMAIL',
        error: 'Ce compte a déjà un e-mail de connexion. Utilisez « Changer le mot de passe ».',
      }),
    });
    const err = await run();
    expect(err.kind).toBe('already_has_login_email');
    expect(loginCredentialsErrorMessage(err)).toBe('Un e-mail de connexion est déjà associé à ce compte.');
  });

  it('429 RATE_LIMITED → rate_limited with a clear French message', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(429, { error: 'Too many requests, please try again later.', code: 'RATE_LIMITED' }, { 'Retry-After': '3600' }),
    });
    const err = await run();
    expect(err.kind).toBe('rate_limited');
    expect(loginCredentialsErrorMessage(err)).toBe('Trop de tentatives. Réessaie dans quelques minutes.');
  });

  it('401 UNAUTHENTICATED → session_expired, recognised by the Task 6 expiry path', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(401, { success: false, code: 'UNAUTHENTICATED' }) });
    const err = await run();
    expect(err.kind).toBe('session_expired');
    expect(isSessionExpiry(err)).toBe(true);
    expect(loginCredentialsErrorMessage(err)).toBe('Ta session a expiré, reconnecte-toi.');
  });

  it('502 EMAIL_SEND_FAILED → the server French message as is', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(502, {
        success: false,
        code: 'EMAIL_SEND_FAILED',
        error: "L'e-mail de confirmation n'a pas pu être envoyé. Vérifiez l'adresse et réessayez.",
      }),
    });
    const err = await run();
    expect(err.kind).toBe('email_failed');
    expect(loginCredentialsErrorMessage(err)).toBe(
      "L'e-mail de confirmation n'a pas pu être envoyé. Vérifiez l'adresse et réessayez.",
    );
  });

  it('500 INTERNAL (e.g. a GoTrue pwned refusal) → generic message, never the pwned text', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(500, { success: false, code: 'INTERNAL', error: "Erreur lors de l'enregistrement." }),
    });
    const err = await run();
    expect(err.kind).toBe('unknown');
    expect(loginCredentialsErrorMessage(err)).toBe('Une erreur est survenue. Réessaie.');
  });

  it('network failure → generic message', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' },
    });
    const err = await run();
    expect(err.kind).toBe('unknown');
    expect(loginCredentialsErrorMessage(err)).toBe('Une erreur est survenue. Réessaie.');
  });

  it('a 200 without success:true is an error', async () => {
    mockInvoke.mockResolvedValue({ data: { error: 'Echec' }, error: null });
    await expect(setLoginCredentials(GUIDE_EMAIL, GUIDE_PASSWORD, GUIDE_PASSWORD)).rejects.toBeInstanceOf(
      LoginCredentialsError,
    );
  });

  it('never calls signUp / signInWithPassword / the users table', async () => {
    await setLoginCredentials(GUIDE_EMAIL, GUIDE_PASSWORD, GUIDE_PASSWORD);
    expect(mockSignUp).not.toHaveBeenCalled();
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('submitLoginCredentials (flag persisted per user)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ data: CREDENTIALS_OK, error: null });
  });

  it('200 pending → outcome pending_confirmation and the flag is set for that user only', async () => {
    await expect(submitLoginCredentials('user-a', GUIDE_EMAIL, GUIDE_PASSWORD, GUIDE_PASSWORD)).resolves.toEqual({
      status: 'pending_confirmation',
      email: GUIDE_EMAIL,
    });
    expect(await hasSubmittedCredentials('user-a')).toBe(true);
    expect(await hasSubmittedCredentials('user-b')).toBe(false);
  });

  it('409 ALREADY_HAS_LOGIN_EMAIL → success for the flow: flag set, outcome already_has_login_email', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(409, { success: false, code: 'ALREADY_HAS_LOGIN_EMAIL', error: 'Ce compte a déjà un e-mail de connexion.' }),
    });
    await expect(submitLoginCredentials('user-a', GUIDE_EMAIL, GUIDE_PASSWORD, GUIDE_PASSWORD)).resolves.toEqual({
      status: 'already_has_login_email',
      email: GUIDE_EMAIL,
    });
    expect(await hasSubmittedCredentials('user-a')).toBe(true);
  });

  it('other errors do not set the flag (EMAIL_TAKEN, validation, 429)', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(409, { success: false, code: 'EMAIL_TAKEN', error: 'Cette adresse e-mail est déjà utilisée.' }),
    });
    await expect(submitLoginCredentials('user-a', GUIDE_EMAIL, GUIDE_PASSWORD, GUIDE_PASSWORD)).rejects.toBeInstanceOf(
      LoginCredentialsError,
    );
    await expect(submitLoginCredentials('user-a', GUIDE_EMAIL, GUIDE_PASSWORD, 'Different12345')).rejects.toBeInstanceOf(
      LoginCredentialsError,
    );
    expect(await hasSubmittedCredentials('user-a')).toBe(false);
  });
});

describe('loginCredentialsFlag (AsyncStorage)', () => {
  beforeEach(() => AsyncStorage.clear());

  it('stores credentialsSubmitted:<userId> and reads it back per user', async () => {
    expect(await hasSubmittedCredentials('user-a')).toBe(false);
    await markCredentialsSubmitted('user-a');
    expect(await AsyncStorage.getAllKeys()).toEqual(['credentialsSubmitted:user-a']);
    expect(await hasSubmittedCredentials('user-a')).toBe(true);
    expect(await hasSubmittedCredentials('user-b')).toBe(false);
  });

  it('never throws on storage errors (reads as not submitted)', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('boom'));
    await expect(hasSubmittedCredentials('user-a')).resolves.toBe(false);
  });

  it('ignores an empty user id', async () => {
    await markCredentialsSubmitted('');
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
    expect(await hasSubmittedCredentials('')).toBe(false);
  });
});

describe('needsLoginCredentials (mirrors backend hasNoLoginEmail)', () => {
  it.each([
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['blank', '   '],
    ['phone placeholder', '243899999999@phone.visiodoc.local'],
    ['phone placeholder, upper case', '243899999999@PHONE.VISIODOC.LOCAL'],
    ['phone placeholder with spaces', '  243899999999@phone.visiodoc.local '],
  ])('is true when the auth e-mail is %s', (_name, email) => {
    expect(needsLoginCredentials({ id: 'u1', phone: '243899999999', email })).toBe(true);
  });

  it('is true for a user without any e-mail field, with or without phone', () => {
    expect(needsLoginCredentials({ id: 'u1', phone: '243899999999' })).toBe(true);
    expect(needsLoginCredentials({ id: 'u1' })).toBe(true);
  });

  it('is false for a real e-mail (returning user) and for a look-alike domain', () => {
    expect(needsLoginCredentials({ id: 'u1', phone: '243899999999', email: 'patient.recup@exemple.com' })).toBe(false);
    expect(needsLoginCredentials({ id: 'u1', email: 'x@phone.visiodoc.local.example.com' })).toBe(false);
    expect(needsLoginCredentials({ id: 'u1', email: 'x@visiodoc.local' })).toBe(false);
  });

  it('is false once the credentials were submitted for this user', () => {
    expect(needsLoginCredentials({ id: 'u1', phone: '243899999999', email: '' }, true)).toBe(false);
  });

  it('is false for no user at all', () => {
    expect(needsLoginCredentials(null)).toBe(false);
    expect(needsLoginCredentials(undefined)).toBe(false);
  });
});

describe('shouldAskLoginCredentials (rule + persisted flag)', () => {
  beforeEach(() => AsyncStorage.clear());
  const placeholderUser = { id: 'u1', phone: '243899999999', email: '243899999999@phone.visiodoc.local' };

  it('asks a legacy placeholder-email user at OTP login', async () => {
    await expect(shouldAskLoginCredentials(placeholderUser)).resolves.toBe(true);
  });

  it('asks a phone user with an empty e-mail', async () => {
    await expect(shouldAskLoginCredentials({ id: 'u1', phone: '243899999999', email: '' })).resolves.toBe(true);
  });

  it('does not ask a user with a real e-mail', async () => {
    await expect(shouldAskLoginCredentials({ id: 'u1', phone: '243899999999', email: 'a@b.cd' })).resolves.toBe(false);
  });

  it('does not ask again once this user submitted (the e-mail is still pending confirmation)', async () => {
    await markCredentialsSubmitted('u1');
    await expect(shouldAskLoginCredentials(placeholderUser)).resolves.toBe(false);
  });

  it("another user's flag does not skip the step", async () => {
    await markCredentialsSubmitted('someone-else');
    await expect(shouldAskLoginCredentials(placeholderUser)).resolves.toBe(true);
  });
});

describe('code resend cooldown per phone number (E.164, in-memory)', () => {
  beforeEach(() => resetCodeCooldowns());
  const A = '+243899999999';
  const B = '+243810000001';

  it('is 0 for a number nothing was sent to', () => {
    expect(codeCooldownRemaining(A, 5000)).toBe(0);
  });

  it('is 60 right after sending to a number and counts down', () => {
    markCodeSent(A, 1000);
    expect(codeCooldownRemaining(A, 1000)).toBe(60);
    expect(codeCooldownRemaining(A, 31000)).toBe(30);
    expect(codeCooldownRemaining(A, 61000)).toBe(0);
  });

  it('sending to A does not block B', () => {
    markCodeSent(A, 1000);
    expect(codeCooldownRemaining(B, 2000)).toBe(0);
    expect(codeCooldownRemaining(A, 2000)).toBe(59);
  });

  it('a new send to A restarts only the clock of A', () => {
    markCodeSent(A, 1000);
    markCodeSent(B, 20000);
    markCodeSent(A, 50000);
    expect(codeCooldownRemaining(A, 50000)).toBe(60);
    expect(codeCooldownRemaining(B, 50000)).toBe(30);
  });

  it('survives re-opening the screen (module-level state, not component state)', () => {
    markCodeSent(A, 1000);
    // « démontage / remontage » : seul le module est lu, la valeur persiste
    expect(codeCooldownRemaining(A, 11000)).toBe(50);
  });

  it('is 0 for an empty number', () => {
    expect(codeCooldownRemaining('', 1000)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Étape inachevée : marqueur `credentialsPending:<userId>` (anti-contournement à la restauration)
// ---------------------------------------------------------------------------------------------

describe('credentialsPending marker', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ data: CREDENTIALS_OK, error: null });
  });
  const newPhoneUser = { id: 'u1', phone: '243899999999', email: '' };

  it('requireLoginCredentialsStep sets credentialsPending:<userId> when the step is needed', async () => {
    await expect(requireLoginCredentialsStep(newPhoneUser)).resolves.toBe(true);
    expect(await AsyncStorage.getAllKeys()).toEqual(['credentialsPending:u1']);
    expect(await hasCredentialsPending('u1')).toBe(true);
    expect(await pendingCredentialsUserIds()).toEqual(['u1']);
  });

  it('requireLoginCredentialsStep sets nothing for a user with a real e-mail, and clears a stale marker', async () => {
    await markCredentialsPending('u1');
    await expect(requireLoginCredentialsStep({ id: 'u1', phone: '243899999999', email: 'a@b.cd' })).resolves.toBe(false);
    expect(await hasCredentialsPending('u1')).toBe(false);
  });

  it('requireLoginCredentialsStep sets nothing for a user whose step was already submitted', async () => {
    await markCredentialsSubmitted('u1');
    await expect(requireLoginCredentialsStep(newPhoneUser)).resolves.toBe(false);
    expect(await hasCredentialsPending('u1')).toBe(false);
  });

  it('a successful submit clears the marker (and sets the submitted flag)', async () => {
    await requireLoginCredentialsStep(newPhoneUser);
    await submitLoginCredentials('u1', GUIDE_EMAIL, GUIDE_PASSWORD, GUIDE_PASSWORD);
    expect(await hasCredentialsPending('u1')).toBe(false);
    expect(await hasSubmittedCredentials('u1')).toBe(true);
  });

  it('ALREADY_HAS_LOGIN_EMAIL clears the marker too', async () => {
    await requireLoginCredentialsStep(newPhoneUser);
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(409, { success: false, code: 'ALREADY_HAS_LOGIN_EMAIL', error: 'Ce compte a déjà un e-mail de connexion.' }),
    });
    await submitLoginCredentials('u1', GUIDE_EMAIL, GUIDE_PASSWORD, GUIDE_PASSWORD);
    expect(await hasCredentialsPending('u1')).toBe(false);
  });

  it('a failed submit keeps the marker (the step is still owed)', async () => {
    await requireLoginCredentialsStep(newPhoneUser);
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(409, { success: false, code: 'EMAIL_TAKEN', error: 'Cette adresse e-mail est déjà utilisée.' }),
    });
    await expect(submitLoginCredentials('u1', GUIDE_EMAIL, GUIDE_PASSWORD, GUIDE_PASSWORD)).rejects.toBeInstanceOf(
      LoginCredentialsError,
    );
    expect(await hasCredentialsPending('u1')).toBe(true);
  });

  it('clearCredentialsPending removes only that user and ignores an empty id', async () => {
    await markCredentialsPending('u1');
    await markCredentialsPending('u2');
    await markCredentialsPending('');
    await clearCredentialsPending('u1');
    expect(await pendingCredentialsUserIds()).toEqual(['u2']);
  });

  it('never throws on storage errors', async () => {
    jest.spyOn(AsyncStorage, 'getAllKeys').mockRejectedValueOnce(new Error('boom'));
    await expect(pendingCredentialsUserIds()).resolves.toEqual([]);
  });
});

describe('shouldDropOnRestore (restored session of an unfinished phone signup)', () => {
  it('is true only for a matching marker', () => {
    expect(shouldDropOnRestore('u1', ['u1'])).toBe(true);
    expect(shouldDropOnRestore('u1', ['u2', 'u1'])).toBe(true);
  });

  it('is false for a legacy user without any marker (restored normally)', () => {
    expect(shouldDropOnRestore('u1', [])).toBe(false);
  });

  it("is false when only another user's marker exists", () => {
    expect(shouldDropOnRestore('u1', ['u2'])).toBe(false);
  });

  it('is false without a user id', () => {
    expect(shouldDropOnRestore('', ['u1', ''])).toBe(false);
    expect(shouldDropOnRestore(undefined, ['u1'])).toBe(false);
  });
});
