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
} from './registration';
import { authErrorMessage, edgeFunctionError, isEmailNotConfirmed } from '@/utils/authError';
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
        phone: '+243899999999',
        language: 'fr',
        countryId: CD_UUID,
      },
    });
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

  it('omits countryId when the chosen code has no country UUID in the app config', async () => {
    await registerPatientAccount({ ...patientInput, countryCode: 'SN' });
    const body = mockInvoke.mock.calls[0][1].body;
    expect(Object.keys(body)).not.toContain('countryId');
  });

  it('omits countryId when no country was chosen', async () => {
    await registerPatientAccount({ ...patientInput, countryCode: undefined });
    expect(Object.keys(mockInvoke.mock.calls[0][1].body)).not.toContain('countryId');
  });

  it('omits phone when it is empty, and sends male as is', async () => {
    await registerPatientAccount({ ...patientInput, phone: '  ', gender: 'male' });
    const body = mockInvoke.mock.calls[0][1].body;
    expect(Object.keys(body)).not.toContain('phone');
    expect(body.gender).toBe('male');
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
