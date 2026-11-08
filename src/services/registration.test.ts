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
  LoginCredentialsError,
  loginCredentialsErrorMessage,
  needsLoginCredentials,
} from './registration';
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
// Étape 8 : `set-login-credentials` après l'OTP WhatsApp (e-mail + mot de passe obligatoires)
// ---------------------------------------------------------------------------------------------

const CREDENTIALS_OK = { success: true, message: 'Identifiants mis à jour avec succès' };
const GUIDE_EMAIL = 'patient.recup@exemple.com';
const GUIDE_PASSWORD = 'NouveauMotDePasse123!';

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
    await setLoginCredentials('  Patient.Recup@Exemple.com ', ' Abcdefghij12 ', ' Abcdefghij12 ');
    expect(mockInvoke.mock.calls[0][1].body).toEqual({
      email: GUIDE_EMAIL,
      newPassword: ' Abcdefghij12 ',
      confirmPassword: ' Abcdefghij12 ',
    });
  });

  it('resolves the success shape of the guide on a 200', async () => {
    await expect(setLoginCredentials(GUIDE_EMAIL, GUIDE_PASSWORD, GUIDE_PASSWORD)).resolves.toEqual({
      success: true,
      message: 'Identifiants mis à jour avec succès',
    });
  });

  it('newPassword !== confirmPassword → typed error, function NOT called', async () => {
    const err: LoginCredentialsError = await setLoginCredentials(GUIDE_EMAIL, GUIDE_PASSWORD, 'AutreMotDePasse456').catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(LoginCredentialsError);
    expect(err.kind).toBe('password_mismatch');
    expect(err.message).toBe('Les mots de passe ne correspondent pas.');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it.each([
    ['short', 'Abc12345', 'too_short', 'Le mot de passe doit contenir au moins 10 caractères.'],
    ['no digit', 'AbcdefghijKL', 'needs_letter_and_digit', 'Le mot de passe doit contenir au moins une lettre et un chiffre.'],
    ['no letter', '1234567890123', 'needs_letter_and_digit', 'Le mot de passe doit contenir au moins une lettre et un chiffre.'],
    ['73 chars', `a1${'b'.repeat(71)}`, 'too_long', 'Le mot de passe ne doit pas dépasser 72 caractères.'],
  ])('weak password (%s) → typed error, function NOT called', async (_name, password, _issue, message) => {
    const err: LoginCredentialsError = await setLoginCredentials(GUIDE_EMAIL, password, password).catch((e) => e);
    expect(err).toBeInstanceOf(LoginCredentialsError);
    expect(err.kind).toBe('weak_password');
    expect(err.message).toBe(message);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it.each(['', '   ', 'pas-un-email', 'a@b', 'a b@c.cd', '@exemple.com'])(
    'invalid e-mail %p → typed error, function NOT called',
    async (email) => {
      const err: LoginCredentialsError = await setLoginCredentials(email, GUIDE_PASSWORD, GUIDE_PASSWORD).catch((e) => e);
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

  it('422 weak_password + pwned → the pwned message', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(422, { error: 'Password is known to be weak', error_code: 'weak_password', reasons: ['pwned'] }),
    });
    const err: LoginCredentialsError = await setLoginCredentials(GUIDE_EMAIL, GUIDE_PASSWORD, GUIDE_PASSWORD).catch((e) => e);
    expect(err).toBeInstanceOf(LoginCredentialsError);
    expect(err.kind).toBe('validation');
    expect(loginCredentialsErrorMessage(err)).toBe('Ce mot de passe a déjà fuité sur Internet, choisis-en un autre.');
  });

  it('422 weak_password for another reason is not shown as pwned', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(422, { error: 'Mot de passe trop courant.', error_code: 'weak_password', reasons: ['common'] }),
    });
    const err: LoginCredentialsError = await setLoginCredentials(GUIDE_EMAIL, GUIDE_PASSWORD, GUIDE_PASSWORD).catch((e) => e);
    expect(loginCredentialsErrorMessage(err)).toBe('Mot de passe trop courant.');
  });

  it('400 → validation error with the server message', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(400, { error: 'Les mots de passe ne correspondent pas.' }),
    });
    const err: LoginCredentialsError = await setLoginCredentials(GUIDE_EMAIL, GUIDE_PASSWORD, GUIDE_PASSWORD).catch((e) => e);
    expect(err.kind).toBe('validation');
    expect(loginCredentialsErrorMessage(err)).toBe('Les mots de passe ne correspondent pas.');
  });

  it('409 → conflict error: e-mail already used (existing French message)', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(409, { error: 'Email already registered' }) });
    const err: LoginCredentialsError = await setLoginCredentials(GUIDE_EMAIL, GUIDE_PASSWORD, GUIDE_PASSWORD).catch((e) => e);
    expect(err.kind).toBe('conflict');
    expect(loginCredentialsErrorMessage(err)).toBe('Un compte existe déjà avec cet email.');
  });

  it('429 → rate_limited error with a generic French message', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(429, { error: 'Too many requests' }) });
    const err: LoginCredentialsError = await setLoginCredentials(GUIDE_EMAIL, GUIDE_PASSWORD, GUIDE_PASSWORD).catch((e) => e);
    expect(err.kind).toBe('rate_limited');
    expect(loginCredentialsErrorMessage(err)).toBe('Trop de tentatives. Réessaie dans quelques minutes.');
  });

  it('401 (expired session) → session_expired error recognised by the Task 6 expiry path', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(401, { code: 401, message: 'Invalid JWT' }) });
    const err: LoginCredentialsError = await setLoginCredentials(GUIDE_EMAIL, GUIDE_PASSWORD, GUIDE_PASSWORD).catch((e) => e);
    expect(err.kind).toBe('session_expired');
    expect(isSessionExpiry(err)).toBe(true);
    expect(loginCredentialsErrorMessage(err)).toBe('Ta session a expiré, reconnecte-toi.');
  });

  it('500 → unknown error with a generic French message (never the raw SDK text)', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(500, {}) });
    const err: LoginCredentialsError = await setLoginCredentials(GUIDE_EMAIL, GUIDE_PASSWORD, GUIDE_PASSWORD).catch((e) => e);
    expect(err.kind).toBe('unknown');
    expect(loginCredentialsErrorMessage(err)).toBe('Une erreur est survenue. Réessaie.');
  });

  it('network failure → the usual connection message', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' },
    });
    const err: LoginCredentialsError = await setLoginCredentials(GUIDE_EMAIL, GUIDE_PASSWORD, GUIDE_PASSWORD).catch((e) => e);
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

describe('needsLoginCredentials (phone account without e-mail yet)', () => {
  it('is true for a phone account whose auth e-mail is empty', () => {
    expect(needsLoginCredentials({ id: 'u1', phone: '243899999999', email: '' })).toBe(true);
  });

  it('is true when the e-mail is null, missing or blank', () => {
    expect(needsLoginCredentials({ id: 'u1', phone: '243899999999', email: null })).toBe(true);
    expect(needsLoginCredentials({ id: 'u1', phone: '243899999999' })).toBe(true);
    expect(needsLoginCredentials({ id: 'u1', phone: '+243899999999', email: '   ' })).toBe(true);
  });

  it('is false for a phone account that already has an e-mail (returning user)', () => {
    expect(needsLoginCredentials({ id: 'u1', phone: '243899999999', email: 'patient.recup@exemple.com' })).toBe(false);
  });

  it('is false for an e-mail account without phone (e-mail OTP, OAuth)', () => {
    expect(needsLoginCredentials({ id: 'u1', email: 'a@b.cd' })).toBe(false);
    expect(needsLoginCredentials({ id: 'u1', email: '', phone: '' })).toBe(false);
  });

  it('is false for no user at all', () => {
    expect(needsLoginCredentials(null)).toBe(false);
    expect(needsLoginCredentials(undefined)).toBe(false);
  });
});
