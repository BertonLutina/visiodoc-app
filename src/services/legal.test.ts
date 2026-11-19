import { Share } from 'react-native';
import {
  buildLegalAcceptance,
  exportMyData,
  healthConsentIssue,
  legalServerErrorMessage,
  legalUrl,
  logErrorCode,
  requestAccountDeletion,
  shareExport,
  splitTemplate,
  withdrawHealthConsent,
} from './legal';
import { setCurrentLangCode } from '@/i18n/core';

const mockRpc = jest.fn();
const mockInvoke = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabaseConfigured: true,
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
  },
}));

beforeEach(() => {
  setCurrentLangCode('fr');
  mockRpc.mockReset();
  mockInvoke.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('buildLegalAcceptance', () => {
  it('patient : CGU patient, confidentialité, consentement santé, plateforme mobile', () => {
    expect(buildLegalAcceptance('patient', true)).toEqual({
      cguVersion: 'CGU-PATIENT-v2',
      privacyVersion: 'CONFID-v2',
      healthConsent: true,
      healthConsentVersion: 'CONSENT-SANTE-v1',
      platform: 'mobile',
    });
  });
  it('prestataire : CGU pro, sans consentement santé', () => {
    expect(buildLegalAcceptance('provider')).toEqual({
      cguVersion: 'CGU-PRO-v2',
      privacyVersion: 'CONFID-v2',
      platform: 'mobile',
    });
  });
});

describe('healthConsentIssue', () => {
  it("refuse tant que la case n'est pas cochée", () => {
    expect(healthConsentIssue(false)).not.toBeNull();
    expect(healthConsentIssue(undefined)).not.toBeNull();
    expect(healthConsentIssue(true)).toBeNull();
  });
});

describe('legalServerErrorMessage', () => {
  it('traduit les 3 textes du guide et ignore le reste', () => {
    setCurrentLangCode('sw');
    expect(legalServerErrorMessage("Vous devez accepter les conditions d'utilisation.")).toBe(
      'Lazima ukubali masharti ya matumizi.',
    );
    expect(legalServerErrorMessage('autre')).toBeNull();
  });
});

describe('splitTemplate', () => {
  it("découpe texte et jetons dans l'ordre", () => {
    expect(splitTemplate('a {x} b {y}.', ['x', 'y'])).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'token', name: 'x' },
      { type: 'text', text: ' b ' },
      { type: 'token', name: 'y' },
      { type: 'text', text: '.' },
    ]);
  });
});

describe('legalUrl', () => {
  it('garde le mécanisme existant du site web', () => {
    expect(legalUrl('conditions')).toBe('https://cd.visiodoc.online/?legal=conditions');
  });
});

describe('logErrorCode', () => {
  it('journalise le code seul', () => {
    logErrorCode('x', { code: '23505', message: 'texte base' });
    expect(console.warn).toHaveBeenCalledWith('[legal:x] 23505');
  });
});

describe('requestAccountDeletion', () => {
  it('crée la demande', async () => {
    mockRpc.mockResolvedValue({ data: 'id', error: null });
    await expect(requestAccountDeletion()).resolves.toBe('created');
    expect(mockRpc).toHaveBeenCalledWith('request_account_deletion', { p_reason: null });
  });
  it('23505 : une demande est déjà en cours', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '23505' } });
    await expect(requestAccountDeletion()).resolves.toBe('already_pending');
  });
  it('autre erreur : message traduit, jamais le texte brut', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'XX', message: 'brut' } });
    await expect(requestAccountDeletion()).rejects.toThrow(
      "La demande n'a pas pu être envoyée. Réessayez dans un instant.",
    );
  });
});

describe('withdrawHealthConsent', () => {
  it('appelle la RPC et renvoie le nombre de lignes', async () => {
    mockRpc.mockResolvedValue({ data: 1, error: null });
    await expect(withdrawHealthConsent()).resolves.toBe(1);
    expect(mockRpc).toHaveBeenCalledWith('withdraw_legal_acceptance', { p_document: 'health_consent' });
  });
  it('erreur : message traduit', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'XX' } });
    await expect(withdrawHealthConsent()).rejects.toThrow("Le retrait n'a pas pu être enregistré.");
  });
});

describe('exportMyData', () => {
  const httpError = (status: number) => ({ context: new Response('{}', { status }) });
  it('renvoie le JSON', async () => {
    mockInvoke.mockResolvedValue({ data: { schemaVersion: 1 }, error: null });
    await expect(exportMyData()).resolves.toEqual({ schemaVersion: 1 });
    expect(mockInvoke.mock.calls[0][0]).toBe('export-my-data');
  });
  it('429 : limite quotidienne', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(429) });
    await expect(exportMyData()).rejects.toThrow('limite de 3 exports par jour');
  });
  it('autre erreur : message générique', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(500) });
    await expect(exportMyData()).rejects.toThrow("L'export n'a pas pu être généré.");
  });
});

describe('shareExport', () => {
  it('partage le JSON formaté', async () => {
    const spy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    await shareExport({ a: 1 });
    expect(spy.mock.calls[0][0]).toMatchObject({ message: '{\n  "a": 1\n}' });
  });
});
