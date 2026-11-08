import { buildRegisterPrestaBody, resolveSpecialty } from './registration';
import { authErrorMessage, edgeFunctionError } from '@/utils/authError';

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
