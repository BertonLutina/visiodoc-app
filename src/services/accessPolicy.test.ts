import { mobileRole, providerGate, providerHomeHref, providerRefusalReason, subscriptionScreenMode } from './accessPolicy';
import { en } from '@/i18n/locales/en';
import { sw } from '@/i18n/locales/sw';
import { ln } from '@/i18n/locales/ln';
import {
  ROLE_NOT_ALLOWED,
  authErrorMessage,
  isRoleNotAllowed,
  providerRefusal,
  providerRefusalError,
  providerRefusalMessage,
  roleNotAllowedError,
} from '@/utils/authError';
import { setCurrentLangCode } from '@/i18n/core';

describe('mobileRole', () => {
  it.each(['country_admin', 'COUNTRY_ADMIN', 'provider_validator', 'PROVIDER_VALIDATOR'])(
    'refuses the web-only role %s',
    (role) => {
      expect(mobileRole(role)).toBeNull();
    },
  );

  it.each(['super_admin', 'SUPER_ADMIN', 'admin', 'ADMIN'])('refuses the administrator role %s', (role) => {
    expect(mobileRole(role)).toBeNull();
  });

  it('opens the provider space for provider and doctor, whatever the case', () => {
    expect(mobileRole('doctor')).toBe('provider');
    expect(mobileRole('DOCTOR')).toBe('provider');
    expect(mobileRole('provider')).toBe('provider');
    expect(mobileRole('PROVIDER')).toBe('provider');
  });

  it('opens the patient space for patient, whatever the case', () => {
    expect(mobileRole('patient')).toBe('patient');
    expect(mobileRole('PATIENT')).toBe('patient');
  });

  it('refuses an empty, missing or unknown role instead of treating it as a patient', () => {
    expect(mobileRole('')).toBeNull();
    expect(mobileRole(null)).toBeNull();
    expect(mobileRole(undefined)).toBeNull();
    expect(mobileRole('foo')).toBeNull();
  });
});

describe('role refusal message', () => {
  afterEach(() => setCurrentLangCode('fr'));

  it("shows the exact text of the guide, with the final period", () => {
    setCurrentLangCode('fr');
    expect(authErrorMessage(roleNotAllowedError())).toBe("Vous n'êtes pas autorisé ici, utilisez la version web.");
  });

  it('is translated in English', () => {
    setCurrentLangCode('en');
    expect(authErrorMessage(roleNotAllowedError())).toBe('You are not authorised here, please use the web version.');
  });

  it('is recognised by its code and not confused with another error', () => {
    expect(roleNotAllowedError().message).toBe(ROLE_NOT_ALLOWED);
    expect(isRoleNotAllowed(roleNotAllowedError())).toBe(true);
    expect(isRoleNotAllowed(new Error('Invalid login credentials'))).toBe(false);
    expect(isRoleNotAllowed(null)).toBe(false);
  });
});

describe('providerGate', () => {
  it("opens the full provider space only for 'VALIDE_ABO_ACTIF'", () => {
    expect(providerGate('VALIDE_ABO_ACTIF', true)).toBe('full');
    expect(providerGate('VALIDE_ABO_ACTIF', undefined)).toBe('full');
  });

  it("asks for a subscription (no sign-out) for 'VALIDE_SANS_ABO' and 'profil_valide'", () => {
    expect(providerGate('VALIDE_SANS_ABO', true)).toBe('subscribe');
    expect(providerGate('profil_valide', true)).toBe('subscribe');
  });

  it("treats both spellings of the waiting status as 'pending', never as full access", () => {
    expect(providerGate('en_attente_de_validation', true)).toBe('pending');
    expect(providerGate('EN_ATTENTE_VALIDATION', true)).toBe('pending');
    expect(providerGate('en_attente_de_validation', true)).not.toBe('full');
  });

  it("gives 'profil_rejete' its own state", () => {
    expect(providerGate('profil_rejete', true)).toBe('rejected');
  });

  it("sends 'profil_incomplet' to the incomplete state", () => {
    expect(providerGate('profil_incomplet', true)).toBe('incomplete');
  });

  it('suspends the account when is_active is false, whatever the status', () => {
    expect(providerGate('VALIDE_ABO_ACTIF', false)).toBe('suspended');
    expect(providerGate('VALIDE_SANS_ABO', false)).toBe('suspended');
    expect(providerGate('profil_rejete', false)).toBe('suspended');
    expect(providerGate(null, false)).toBe('suspended');
  });

  it('falls back to incomplete for a missing or unknown status', () => {
    expect(providerGate(null, true)).toBe('incomplete');
    expect(providerGate(undefined, true)).toBe('incomplete');
    expect(providerGate('', true)).toBe('incomplete');
    expect(providerGate('SUSPENDED', true)).toBe('incomplete');
    expect(providerGate('foo', undefined)).toBe('incomplete');
  });

  it('compares strictly: a wrong-case status is not recognised', () => {
    expect(providerGate('valide_abo_actif', true)).toBe('incomplete');
    expect(providerGate('PROFIL_REJETE', true)).toBe('incomplete');
    expect(providerGate('PROFIL_VALIDE', true)).toBe('incomplete');
    expect(providerGate('valide_sans_abo', true)).toBe('incomplete');
    expect(providerGate('EN_ATTENTE_DE_VALIDATION', true)).toBe('incomplete');
    expect(providerGate('en_attente_validation', true)).toBe('incomplete');
  });
});

describe('providerHomeHref', () => {
  it('sends a patient to the patient space whatever the provider fields say', () => {
    expect(providerHomeHref({ role: 'patient', doctorStatus: 'profil_rejete', isActive: false })).toBe('/(patient)');
    expect(providerHomeHref({ role: 'patient' })).toBe('/(patient)');
  });

  it('sends a fully validated provider to the provider home', () => {
    expect(providerHomeHref({ role: 'provider', doctorStatus: 'VALIDE_ABO_ACTIF', isActive: true })).toBe('/(provider)');
  });

  it('sends a provider without active subscription to the subscription screen', () => {
    expect(providerHomeHref({ role: 'provider', doctorStatus: 'VALIDE_SANS_ABO', isActive: true })).toBe(
      '/provider/subscription',
    );
    expect(providerHomeHref({ role: 'provider', doctorStatus: 'profil_valide', isActive: true })).toBe(
      '/provider/subscription',
    );
  });

  it('never opens the provider tabs for a provider the gate refuses', () => {
    expect(providerHomeHref({ role: 'provider', doctorStatus: 'profil_rejete', isActive: true })).not.toBe('/(provider)');
    expect(providerHomeHref({ role: 'provider', doctorStatus: 'VALIDE_ABO_ACTIF', isActive: false })).not.toBe('/(provider)');
  });
});

describe('providerRefusalReason', () => {
  it('never refuses a patient, even with provider-looking fields', () => {
    expect(providerRefusalReason({ role: 'patient' })).toBeNull();
    expect(providerRefusalReason({ role: 'patient', doctorStatus: 'profil_rejete', isActive: false })).toBeNull();
  });

  it('keeps full and subscribe providers signed in', () => {
    expect(providerRefusalReason({ role: 'provider', doctorStatus: 'VALIDE_ABO_ACTIF', isActive: true })).toBeNull();
    expect(providerRefusalReason({ role: 'provider', doctorStatus: 'VALIDE_SANS_ABO', isActive: true })).toBeNull();
    expect(providerRefusalReason({ role: 'provider', doctorStatus: 'profil_valide', isActive: true })).toBeNull();
  });

  it('refuses each other state with its own reason', () => {
    expect(providerRefusalReason({ role: 'provider', doctorStatus: 'en_attente_de_validation', isActive: true })).toBe('pending');
    expect(providerRefusalReason({ role: 'provider', doctorStatus: 'EN_ATTENTE_VALIDATION', isActive: true })).toBe('pending');
    expect(providerRefusalReason({ role: 'provider', doctorStatus: 'profil_rejete', isActive: true })).toBe('rejected');
    expect(providerRefusalReason({ role: 'provider', doctorStatus: 'profil_incomplet', isActive: true })).toBe('incomplete');
    expect(providerRefusalReason({ role: 'provider', doctorStatus: 'VALIDE_ABO_ACTIF', isActive: false })).toBe('suspended');
    expect(providerRefusalReason({ role: 'provider' })).toBe('incomplete');
  });
});

describe('provider refusal messages', () => {
  afterEach(() => setCurrentLangCode('fr'));

  it('shows one distinct French message per refused status', () => {
    setCurrentLangCode('fr');
    expect(authErrorMessage(providerRefusalError('pending'))).toBe(
      'Ton compte est en attente de validation par notre équipe.',
    );
    expect(authErrorMessage(providerRefusalError('rejected'))).toBe(
      'Ton profil a été refusé. Contacte le support pour en savoir plus.',
    );
    expect(authErrorMessage(providerRefusalError('incomplete'))).toBe(
      'Ton profil est incomplet. Finalise ton dossier pour continuer.',
    );
    expect(authErrorMessage(providerRefusalError('suspended'))).toBe('Ton compte est suspendu. Contacte le support.');
  });

  it('maps a refusal reason to its message directly', () => {
    expect(providerRefusalMessage('rejected')).toBe('Ton profil a été refusé. Contacte le support pour en savoir plus.');
  });

  it('translates the messages in English', () => {
    setCurrentLangCode('en');
    expect(providerRefusalMessage('pending')).toBe('Your account is awaiting validation by our team.');
  });

  it('recognises a refusal by its error and returns the reason', () => {
    expect(providerRefusal(providerRefusalError('pending'))).toBe('pending');
    expect(providerRefusal(providerRefusalError('rejected'))).toBe('rejected');
    expect(providerRefusal(providerRefusalError('incomplete'))).toBe('incomplete');
    expect(providerRefusal(providerRefusalError('suspended'))).toBe('suspended');
    expect(providerRefusal(new Error('Invalid login credentials'))).toBeNull();
    expect(providerRefusal(roleNotAllowedError())).toBeNull();
    expect(providerRefusal(null)).toBeNull();
  });
});

describe('subscriptionScreenMode (no mock plans for restricted providers)', () => {
  it("is 'restricted' for a provider whose gate is 'subscribe'", () => {
    expect(subscriptionScreenMode({ role: 'provider', doctorStatus: 'VALIDE_SANS_ABO', isActive: true })).toBe('restricted');
    expect(subscriptionScreenMode({ role: 'provider', doctorStatus: 'profil_valide', isActive: true })).toBe('restricted');
  });

  it("is 'full' for a provider with an active subscription", () => {
    expect(subscriptionScreenMode({ role: 'provider', doctorStatus: 'VALIDE_ABO_ACTIF', isActive: true })).toBe('full');
  });

  it("is 'restricted' without a user (never shows mock prices to a visitor)", () => {
    expect(subscriptionScreenMode(null)).toBe('restricted');
  });

  it('ships the restricted-access notice in en, sw and ln', () => {
    const key = "L'abonnement sera bientôt disponible dans l'application. Ton accès est limité en attendant.";
    for (const dict of [en, sw, ln]) {
      expect(typeof dict[key]).toBe('string');
      expect(dict[key].length).toBeGreaterThan(10);
      expect(dict[key]).not.toBe(key);
    }
  });
});
