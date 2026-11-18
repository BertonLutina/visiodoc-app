import {
  buildChildDoctorAccess,
  calculateChildAge,
  childErrorCode,
  childErrorMessage,
  isValidChildBirthDate,
  latestMeasurements,
  measurementAgeText,
  measurementPlausibilityWarning,
  parseMeasurementInput,
  validateChildInput,
  validateMeasurements,
} from './childrenApi';
import type { AddChildInput } from '@/types/children';

const NOW = new Date('2026-11-18T10:00:00');

const valid: AddChildInput = {
  firstName: 'Léa',
  lastName: 'Mukendi',
  dateOfBirth: '2019-05-10',
  gender: 'female',
  declarationAccepted: true,
  consentAccepted: true,
};

describe('âge et date de naissance d’un enfant (moins de 18 ans révolus)', () => {
  it('calcule les années révolues', () => {
    expect(calculateChildAge('2019-11-18', NOW)).toBe(7);
    expect(calculateChildAge('2019-11-19', NOW)).toBe(6);
    expect(calculateChildAge('', NOW)).toBeNull();
    expect(calculateChildAge('pas-une-date', NOW)).toBeNull();
  });

  it('accepte 17 ans révolus, refuse exactement 18 ans (adulte), une date future et un format invalide', () => {
    expect(isValidChildBirthDate('2008-11-19', NOW)).toBe(true); // 17 ans et 364 jours
    expect(isValidChildBirthDate('2008-11-18', NOW)).toBe(false); // 18 ans pile
    expect(isValidChildBirthDate('1990-01-01', NOW)).toBe(false);
    expect(isValidChildBirthDate('2026-11-19', NOW)).toBe(false); // futur
    expect(isValidChildBirthDate('18/11/2019', NOW)).toBe(false);
  });
});

describe('validateChildInput', () => {
  it('accepte un enfant valide sans poids ni taille', () => {
    expect(validateChildInput(valid, NOW)).toBeNull();
  });

  it('refuse un adulte comme enfant', () => {
    expect(validateChildInput({ ...valid, dateOfBirth: '2000-01-01' }, NOW)).toBe('child_must_be_under_18');
  });

  it('exige les deux cases, séparément', () => {
    expect(validateChildInput({ ...valid, declarationAccepted: false }, NOW)).toBe('acceptance_required');
    expect(validateChildInput({ ...valid, consentAccepted: false }, NOW)).toBe('acceptance_required');
  });

  it('refuse un nom vide, trop long ou contenant < >, et un genre autre que male/female', () => {
    expect(validateChildInput({ ...valid, firstName: '  ' }, NOW)).toBe('invalid_name');
    expect(validateChildInput({ ...valid, lastName: 'x'.repeat(81) }, NOW)).toBe('invalid_name');
    expect(validateChildInput({ ...valid, firstName: '<b>Léa</b>' }, NOW)).toBe('invalid_name');
    expect(validateChildInput({ ...valid, gender: null }, NOW)).toBe('invalid_gender');
  });
});

describe('mesures partielles', () => {
  it('poids et taille sont optionnels à l’ajout, mais bornés quand ils sont fournis', () => {
    expect(validateMeasurements(null, null, { required: false })).toBeNull();
    expect(validateMeasurements(12, null, { required: false })).toBeNull();
    expect(validateMeasurements(null, 95, { required: false })).toBeNull();
    expect(validateMeasurements(0.2, null, { required: false })).toBe('measurement_out_of_range');
    expect(validateMeasurements(null, 231, { required: false })).toBe('measurement_out_of_range');
  });

  it('une mesure enregistrée exige au moins une valeur', () => {
    expect(validateMeasurements(null, null, { required: true })).toBe('measurement_required');
    expect(validateMeasurements(undefined, undefined, { required: true })).toBe('measurement_required');
    expect(validateMeasurements(null, 100, { required: true })).toBeNull();
  });

  it('lit la saisie avec virgule ou point, vide = null, illisible = NaN', () => {
    expect(parseMeasurementInput('12,5')).toBe(12.5);
    expect(parseMeasurementInput('95')).toBe(95);
    expect(parseMeasurementInput('  ')).toBeNull();
    expect(Number.isNaN(parseMeasurementInput('abc'))).toBe(true);
  });

  it('lit le dernier poids et la dernière taille SÉPARÉMENT (la ligne la plus récente peut être partielle)', () => {
    const rows = [
      { weight_kg: null, height_cm: 112, measured_at: '2026-11-01T10:00:00Z' }, // correction de taille seule
      { weight_kg: '19.5', height_cm: 108, measured_at: '2026-08-01T10:00:00Z' },
      { weight_kg: 17, height_cm: 100, measured_at: '2026-01-01T10:00:00Z' },
    ];
    expect(latestMeasurements(rows)).toEqual({
      weightKg: 19.5,
      heightCm: 112,
      weightMeasuredAt: '2026-08-01T10:00:00Z',
      heightMeasuredAt: '2026-11-01T10:00:00Z',
      // la plus ancienne des deux dates : le poids de août n'est pas présenté comme récent
      measuredAt: '2026-08-01T10:00:00Z',
    });
  });

  it('renvoie null sans aucune valeur, et gère un enfant avec le poids seul', () => {
    expect(latestMeasurements([])).toBeNull();
    expect(latestMeasurements([{ weight_kg: null, height_cm: null, measured_at: '2026-01-01T00:00:00Z' }])).toBeNull();
    const only = latestMeasurements([{ weight_kg: 14, height_cm: null, measured_at: '2026-01-01T00:00:00Z' }]);
    expect(only?.weightKg).toBe(14);
    expect(only?.heightCm).toBeNull();
    expect(only?.heightMeasuredAt).toBeNull();
  });

  it('avertit sans bloquer quand les valeurs sont peu plausibles', () => {
    expect(measurementPlausibilityWarning(5, 14, 105)).toBeNull();
    expect(measurementPlausibilityWarning(5, 70, null)).toMatch(/âge/);
    expect(measurementPlausibilityWarning(5, 1, null)).toMatch(/poids/i);
    expect(measurementPlausibilityWarning(5, null, 180)).toMatch(/âge/);
    expect(measurementPlausibilityWarning(14, 70, 170)).toBeNull();
  });

  it('exprime l’ancienneté de la mesure', () => {
    expect(measurementAgeText('2026-11-18T08:00:00', NOW)).toBe("saisi aujourd'hui");
    expect(measurementAgeText('2026-11-08T10:00:00', NOW)).toBe('saisi il y a 10 jours');
    expect(measurementAgeText('2026-08-18T10:00:00', NOW)).toBe('saisi il y a 3 mois');
    expect(measurementAgeText(null, NOW)).toBe('');
  });
});

describe('messages d’erreur : jamais de texte technique brut', () => {
  it('reconnaît les codes du guide, même dans un message plus long', () => {
    expect(childErrorCode({ message: 'ERROR: child_must_be_under_18' })).toBe('child_must_be_under_18');
    expect(childErrorCode(new Error('rate_limited'))).toBe('rate_limited');
    expect(childErrorCode({ message: 'duplicate key value violates unique constraint' })).toBeNull();
  });

  it('traduit un code connu', () => {
    expect(childErrorMessage({ message: 'too_many_children' })).toMatch(/10 enfants/);
  });

  it('renvoie un message générique pour une erreur inconnue, sans la reproduire ni journaliser de donnée', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const text = childErrorMessage({ code: '23505', message: 'duplicate key for child Léa Mukendi weight 14' });
    expect(text).toBe('Une erreur est survenue. Réessayez plus tard.');
    expect(text).not.toMatch(/Léa|duplicate|23505/);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toMatch(/Léa|Mukendi|weight/);
    warn.mockRestore();
  });
});

describe('addPatientChild / recordChildMeasurement : RPC seulement', () => {
  const rpcMock = jest.fn();
  const fromMock = jest.fn();
  const load = () => require('./childrenApi');

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    rpcMock.mockResolvedValue({ data: 'child-1', error: null });
    jest.doMock('@/lib/supabase', () => ({
      supabase: { rpc: rpcMock, from: fromMock },
      supabasePublic: null,
      supabaseConfigured: true,
    }));
  });

  afterEach(() => {
    jest.dontMock('@/lib/supabase');
  });

  it('appelle add_patient_child avec les versions de texte, sans aucune écriture directe sur les tables enfants', async () => {
    const id = await load().addPatientChild({ ...valid, weightKg: 18, heightCm: null });
    expect(id).toBe('child-1');
    expect(rpcMock).toHaveBeenCalledWith('add_patient_child', {
      p_first_name: 'Léa',
      p_last_name: 'Mukendi',
      p_date_of_birth: '2019-05-10',
      p_gender: 'female',
      p_declaration_version: load().CHILD_DECLARATION_VERSION,
      p_consent_version: load().CHILD_CONSENT_VERSION,
      p_weight_kg: 18,
      p_height_cm: null,
    });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('n’appelle PAS le serveur pour un adulte ou des cases non cochées', async () => {
    await expect(load().addPatientChild({ ...valid, dateOfBirth: '1999-01-01' })).rejects.toThrow('child_must_be_under_18');
    await expect(load().addPatientChild({ ...valid, consentAccepted: false })).rejects.toThrow('acceptance_required');
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('enregistre une mesure partielle par record_child_measurement (poids seul)', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'm-1', error: null });
    await load().recordChildMeasurement('child-1', 15, null, 'consult-9');
    expect(rpcMock).toHaveBeenCalledWith('record_child_measurement', {
      p_child_id: 'child-1',
      p_weight_kg: 15,
      p_height_cm: null,
      p_consultation_id: 'consult-9',
    });
    await expect(load().recordChildMeasurement('child-1', null, null)).rejects.toThrow('measurement_required');
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('envoie les QUATRE champs du profil santé par update_child_health_profile (champ vide = null)', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    await load().updateChildHealthProfile('child-1', {
      allergies: ' pénicilline ',
      chronicConditions: '',
      currentMedications: '',
      bloodType: 'O+',
    });
    expect(rpcMock).toHaveBeenCalledWith('update_child_health_profile', {
      p_child_id: 'child-1',
      p_allergies: 'pénicilline',
      p_chronic_conditions: null,
      p_current_medications: null,
      p_blood_type: 'O+',
    });
    await expect(
      load().updateChildHealthProfile('child-1', { allergies: '', chronicConditions: '', currentMedications: '', bloodType: 'Z+' }),
    ).rejects.toThrow('invalid_blood_type');
  });

  it('remonte l’erreur serveur telle quelle à l’appelant (qui la traduit)', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'too_many_children' } });
    await expect(load().addPatientChild(valid)).rejects.toEqual({ message: 'too_many_children' });
  });
});

describe('accès des médecins au dossier de l’enfant', () => {
  const consultations = [
    { doctor_id: 'd1', scheduled_at: '2026-11-10T09:00:00Z', doctor: { first_name: 'Amara', last_name: 'Diallo', specialization: 'Pédiatrie' } },
    { doctor_id: 'd1', scheduled_at: '2026-09-01T09:00:00Z', doctor: { first_name: 'Amara', last_name: 'Diallo', specialization: 'Pédiatrie' } },
    { doctor_id: 'd2', scheduled_at: '2026-10-01T09:00:00Z', doctor: [{ first_name: 'Paul', last_name: 'Kabasele', specialization: null }] },
  ];

  it('un médecin par ligne, accès actif par défaut', () => {
    const out = buildChildDoctorAccess(consultations, [], NOW);
    expect(out).toHaveLength(2);
    expect(out.every((d) => !d.revoked)).toBe(true);
    expect(out[0]).toMatchObject({ doctorId: 'd1', lastConsultationAt: '2026-11-10T09:00:00Z', specialization: 'Pédiatrie' });
  });

  it('un accès retiré prévaut sur la consultation ; un accès rétabli (granted) reste actif', () => {
    const out = buildChildDoctorAccess(
      consultations,
      [
        { doctor_id: 'd1', consent_status: 'revoked' },
        { doctor_id: 'd2', consent_status: 'granted', expires_at: null },
      ],
      NOW,
    );
    expect(out.find((d) => d.doctorId === 'd1')?.revoked).toBe(true);
    expect(out.find((d) => d.doctorId === 'd2')?.revoked).toBe(false);
  });

  it('un rétablissement échu compte comme retiré', () => {
    const out = buildChildDoctorAccess(consultations, [{ doctor_id: 'd2', consent_status: 'granted', expires_at: '2026-10-15T00:00:00Z' }], NOW);
    expect(out.find((d) => d.doctorId === 'd2')?.revoked).toBe(true);
  });
});
