import { currentLangCode, translate } from '@/i18n/core';
import { COUNTRIES } from '@/config/countries';
import { getAfricanCountry } from '@/config/africanCountries';
import { toE164 } from '@/utils/phone';
import { supabase } from '@/lib/supabase';
import { specKey } from '@/services/specializationCatalog';
import { edgeFunctionError, pwnedPasswordMessage, authErrorMessage, readHttpError } from '@/utils/authError';
import { passwordIssue, passwordIssueMessage } from '@/services/passwordPolicy';

/** `users.gender` : uniquement `male` ou `female` (guide). `other` est interdit. */
export type Gender = 'male' | 'female';

export const isGender = (v: unknown): v is Gender => v === 'male' || v === 'female';

export interface RegisterPrestaInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  /** Volontairement large : la validation (male/female) se fait dans `buildRegisterPrestaBody`. */
  gender?: string | null;
  phone?: string;
  /** Code ISO du pays choisi (indicatif téléphonique pour le format E.164). */
  countryCode?: string;
  /** UUID d'un `service_types` officiel, sinon `null` (voir `resolveSpecialty`). */
  serviceTypeId: string | null;
  /** Spécialité hors catalogue proposée par le prestataire, sinon `null`. */
  proposedSpecialtyLabel: string | null;
  countryId?: string;
  city: string;
  licenseNumber: string;
}

export interface RegisterPrestaBody {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  gender: Gender;
  phone: string | undefined;
  serviceTypeId: string | null;
  proposedSpecialtyLabel: string | null;
  countryId: string | undefined;
  city: string;
  licenseNumber: string;
}

/** Indicatif téléphonique du pays choisi (ex. '+243'), `undefined` si le code est inconnu. */
const dialCodeFor = (countryCode?: string): string | undefined =>
  countryCode ? getAfricanCountry(countryCode)?.dialCode : undefined;

/**
 * Corps de `POST /functions/v1/register-presta` (guide « Inscription Prestataire »).
 * Lève AVANT tout appel réseau si le genre est absent ou différent de `male` / `female`.
 */
export function buildRegisterPrestaBody(input: RegisterPrestaInput): RegisterPrestaBody {
  if (!isGender(input.gender)) {
    throw new Error(translate('Choisis ton genre : Masculin ou Féminin.'));
  }
  return {
    email: input.email.trim().toLowerCase(),
    password: input.password,
    firstName: input.firstName,
    lastName: input.lastName,
    gender: input.gender,
    phone: toE164(input.phone, dialCodeFor(input.countryCode)),
    serviceTypeId: input.serviceTypeId,
    proposedSpecialtyLabel: input.proposedSpecialtyLabel?.trim() || null,
    countryId: input.countryId,
    city: input.city.trim(),
    licenseNumber: input.licenseNumber,
  };
}

/**
 * Traduit le libellé choisi dans le formulaire en `serviceTypeId` (spécialité officielle du
 * catalogue `service_types`) ou, à défaut, en `proposedSpecialtyLabel` (spécialité proposée, comme
 * `suggestSpecializations` : libellé absent de la liste officielle).
 */
export function resolveSpecialty(
  label: string,
  catalog: { id: string; label: string }[],
): { serviceTypeId: string | null; proposedSpecialtyLabel: string | null } {
  const key = specKey(label);
  const match = catalog.find((row) => specKey(row.label) === key);
  if (match) return { serviceTypeId: match.id, proposedSpecialtyLabel: null };
  return { serviceTypeId: null, proposedSpecialtyLabel: label.trim() || null };
}

/** Valeur DB `users.gender` → `'male' | 'female' | null` (tout autre contenu, dont l'ancien `other`, devient `null`). */
export function normalizeGender(value: unknown): Gender | null {
  return isGender(value) ? value : null;
}

/** Libellé d'affichage : Masculin / Féminin, sinon « Non renseigné » (jamais de texte brut de la base). */
export function genderLabel(value: unknown): string {
  const gender = normalizeGender(value);
  if (gender === 'male') return translate('Masculin');
  if (gender === 'female') return translate('Féminin');
  return translate('Non renseigné');
}

/* ------------------------------------------------------------------------------------------------
 * Inscription patient : Edge Function `register-patient` + confirmation d'e-mail obligatoire
 * (guide MOB-0612-1). Plus de `supabase.auth.signUp` ni d'insert direct dans `users`.
 * ---------------------------------------------------------------------------------------------- */

/** Délai minimal entre deux renvois de l'e-mail de confirmation. */
export const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Secondes restantes avant de pouvoir renvoyer l'e-mail (0 = renvoi possible).
 * `lastSentAt` / `now` en millisecondes (`Date.now()`) ; `null` = rien n'a encore été envoyé.
 */
export function resendCooldownRemaining(lastSentAt: number | null, now: number): number {
  if (lastSentAt === null) return 0;
  const remainingMs = lastSentAt + RESEND_COOLDOWN_SECONDS * 1000 - now;
  if (remainingMs <= 0) return 0;
  return Math.min(RESEND_COOLDOWN_SECONDS, Math.ceil(remainingMs / 1000));
}

export type RegisterPatientErrorKind = 'validation' | 'conflict' | 'rate_limited' | 'email_failed' | 'unknown';

/** Erreur d'une Edge Function d'inscription, typée selon le statut HTTP réel. */
export class RegisterPatientError extends Error {
  kind: RegisterPatientErrorKind;
  retryAfterSeconds?: number;
  error_code?: string;
  reasons?: string[];

  constructor(
    kind: RegisterPatientErrorKind,
    base: Error & { error_code?: string; reasons?: string[] },
    retryAfterSeconds?: number,
  ) {
    super(base.message);
    this.name = 'RegisterPatientError';
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
    // Conserve `error_code` / `reasons` (422 weak_password + pwned) pour `authErrorMessage`.
    if (base.error_code) this.error_code = base.error_code;
    if (base.reasons) this.reasons = base.reasons;
  }
}

const kindForStatus = (status: number | undefined): RegisterPatientErrorKind => {
  if (status === 400 || status === 422) return 'validation';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status === 502) return 'email_failed';
  return 'unknown';
};

/** `Retry-After` en secondes entières (la forme « date HTTP » n'est pas gérée → `undefined`). */
const parseRetryAfter = (value: string | null | undefined): number | undefined => {
  if (!value || !/^\d+$/.test(value.trim())) return undefined;
  const seconds = Number(value.trim());
  return seconds > 0 ? seconds : undefined;
};

/**
 * Convertit l'erreur `functions.invoke` (FunctionsHttpError : la vraie réponse est dans
 * `error.context`, une `Response`) en `RegisterPatientError` selon le statut HTTP réel.
 */
async function toRegisterError(error: any): Promise<RegisterPatientError> {
  const response = error?.context;
  const status: number | undefined = typeof response?.status === 'number' ? response.status : undefined;
  let body: any = null;
  try {
    body = await response?.json?.();
  } catch {
    /* corps absent ou illisible : on garde le message du SDK */
  }
  const kind = kindForStatus(status);
  const retryAfter = kind === 'rate_limited' ? parseRetryAfter(response?.headers?.get?.('Retry-After')) : undefined;
  return new RegisterPatientError(kind, edgeFunctionError(body, error?.message), retryAfter);
}

/** Message affiché à l'écran : texte du serveur tel quel, sauf 429 (« Trop d'essais ») et mot de passe fuité. */
export function registerPatientErrorMessage(error: any): string {
  if (error instanceof RegisterPatientError) {
    if (error.kind === 'rate_limited') {
      return error.retryAfterSeconds
        ? translate("Trop d'essais. Réessaie dans {seconds} secondes.", { seconds: error.retryAfterSeconds })
        : translate("Trop d'essais. Réessaie dans quelques minutes.");
    }
    if (error.kind !== 'unknown') return pwnedPasswordMessage(error) ?? error.message;
  }
  return authErrorMessage(error);
}

/** Seul `fr` figure dans le guide : toute autre langue de l'app est omise (le serveur choisit). */
const serverLanguage = (language?: string): 'fr' | undefined =>
  (language ?? currentLangCode()) === 'fr' ? 'fr' : undefined;

export interface RegisterPatientAccountInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  /** Volontairement large : validé à l'exécution (male / female uniquement). */
  gender?: string | null;
  phone?: string;
  /** Code ISO du pays choisi, ex. 'CD'. */
  countryCode?: string;
}

/**
 * `POST /functions/v1/register-patient` (jeton anonyme géré par `functions.invoke`).
 * Succès : le compte existe mais n'est PAS connecté, l'e-mail de confirmation est parti.
 *
 * - `gender` : vérifié AVANT tout appel réseau.
 * - `countryId` : UUID du pays choisi si l'app le connaît (`COUNTRIES[code].id`), sinon omis
 *   (le serveur choisit la RDC). Jamais de repli silencieux ni de premier pays d'une liste.
 */
export async function registerPatientAccount(
  input: RegisterPatientAccountInput,
): Promise<{ requiresEmailConfirmation: true }> {
  if (!isGender(input.gender)) {
    throw new Error(translate('Choisis ton genre : Masculin ou Féminin.'));
  }
  if (!supabase) throw new Error(translate('Backend non configuré.'));

  const phone = toE164(input.phone, dialCodeFor(input.countryCode));
  const countryId = input.countryCode ? COUNTRIES[input.countryCode]?.id : undefined;
  const language = serverLanguage();
  const body = {
    email: input.email.trim().toLowerCase(),
    password: input.password,
    firstName: input.firstName,
    lastName: input.lastName,
    gender: input.gender,
    ...(phone ? { phone } : {}),
    ...(language ? { language } : {}),
    ...(countryId ? { countryId } : {}),
  };

  const { data, error } = await supabase.functions.invoke('register-patient', { body });
  if (error) throw await toRegisterError(error);
  if (data?.error) throw new RegisterPatientError('unknown', edgeFunctionError(data));
  if (data?.requiresEmailConfirmation !== true) {
    throw new RegisterPatientError('unknown', new Error(translate('Inscription impossible. Réessaie.')));
  }
  return { requiresEmailConfirmation: true };
}

/**
 * `POST /functions/v1/resend-email-confirmation` avec `{ email, language }`. Le serveur répond un
 * 200 neutre (anti-énumération) : on ne sait donc jamais si un e-mail est réellement parti.
 */
export async function resendEmailConfirmation(email: string, language?: string): Promise<void> {
  if (!supabase) throw new Error(translate('Backend non configuré.'));
  const lang = serverLanguage(language);
  const body = {
    email: email.trim().toLowerCase(),
    ...(lang ? { language: lang } : {}),
  };
  const { error } = await supabase.functions.invoke('resend-email-confirmation', { body });
  if (error) throw await toRegisterError(error);
}

/* ------------------------------------------------------------------------------------------------
 * Étape 8 du guide : un compte créé par téléphone (OTP WhatsApp) reçoit obligatoirement un e-mail et
 * un mot de passe via l'Edge Function `set-login-credentials`.
 * ---------------------------------------------------------------------------------------------- */

/**
 * Vrai si le compte authentifié est un compte « téléphone » auquel il manque encore l'e-mail
 * (donc le mot de passe) : numéro présent, adresse `auth.users.email` vide.
 *
 * Règle retenue : c'est la seule donnée fiable connue juste après `verifyOtp`. GoTrue crée un compte
 * téléphone avec `email` vide ; `set-login-credentials` renseigne ensuite cette adresse. Un
 * utilisateur de retour qui a déjà un e-mail n'est donc jamais ramené à l'étape, et un compte e-mail
 * ou OAuth (sans téléphone) n'est jamais concerné.
 */
export function needsLoginCredentials(
  authUser: { id?: string; phone?: string | null; email?: string | null } | null | undefined,
): boolean {
  if (!authUser) return false;
  const hasPhone = typeof authUser.phone === 'string' && authUser.phone.trim() !== '';
  const hasEmail = typeof authUser.email === 'string' && authUser.email.trim() !== '';
  return hasPhone && !hasEmail;
}

export type LoginCredentialsErrorKind =
  | 'invalid_email'
  | 'weak_password'
  | 'password_mismatch'
  | 'validation'
  | 'conflict'
  | 'rate_limited'
  | 'session_expired'
  | 'unknown';

/** Erreur de `setLoginCredentials` : contrôle client (avant tout appel) ou réponse HTTP de la fonction. */
export class LoginCredentialsError extends Error {
  kind: LoginCredentialsErrorKind;
  error_code?: string;
  reasons?: string[];

  constructor(
    kind: LoginCredentialsErrorKind,
    message: string,
    extra?: { error_code?: string; reasons?: string[] },
  ) {
    super(message);
    this.name = 'LoginCredentialsError';
    this.kind = kind;
    if (extra?.error_code) this.error_code = extra.error_code;
    if (extra?.reasons) this.reasons = extra.reasons;
  }
}

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const credentialsKindForStatus = (status: number | undefined): LoginCredentialsErrorKind => {
  if (status === 401) return 'session_expired';
  if (status === 400 || status === 422) return 'validation';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  return 'unknown';
};

/** Message affiché pour une erreur de `setLoginCredentials` (français, via `translate`). */
export function loginCredentialsErrorMessage(error: any): string {
  if (error instanceof LoginCredentialsError) {
    if (error.kind === 'session_expired') return translate('Ta session a expiré, reconnecte-toi.');
    if (error.kind === 'conflict') return translate('Un compte existe déjà avec cet email.');
    if (error.kind === 'rate_limited') return translate('Trop de tentatives. Réessaie dans quelques minutes.');
    return pwnedPasswordMessage(error) ?? error.message;
  }
  return authErrorMessage(error);
}

/**
 * `POST /functions/v1/set-login-credentials` avec la session de l'utilisateur (l'en-tête
 * `Authorization: Bearer` est ajouté par supabase-js). Corps exact du guide :
 * `{ email, newPassword, confirmPassword }` (pas `password`).
 *
 * Contrôles AVANT tout appel réseau : format de l'e-mail, politique de mot de passe commune
 * (10–72, lettre + chiffre) puis égalité de la confirmation. Le mot de passe n'est ni journalisé ni
 * conservé.
 */
export async function setLoginCredentials(
  email: string,
  newPassword: string,
  confirmPassword: string,
): Promise<{ success: true; message: string }> {
  const cleanEmail = email.trim().toLowerCase();
  if (!EMAIL_FORMAT.test(cleanEmail)) {
    throw new LoginCredentialsError('invalid_email', translate('Adresse email invalide.'));
  }
  const issue = passwordIssue(newPassword);
  if (issue) {
    throw new LoginCredentialsError('weak_password', passwordIssueMessage(issue));
  }
  if (newPassword !== confirmPassword) {
    throw new LoginCredentialsError('password_mismatch', translate('Les mots de passe ne correspondent pas.'));
  }
  if (!supabase) throw new Error(translate('Backend non configuré.'));

  const { data, error } = await supabase.functions.invoke('set-login-credentials', {
    body: { email: cleanEmail, newPassword, confirmPassword },
  });
  if (error) {
    const { status, body } = await readHttpError(error);
    const kind = credentialsKindForStatus(status);
    // `edgeFunctionError` conserve `error_code` / `reasons` (422 weak_password + pwned).
    const base = edgeFunctionError(body);
    throw new LoginCredentialsError(kind, base.message, {
      // 401 : toujours traité comme session expirée (voie Task 6, `isSessionExpiry`).
      error_code: kind === 'session_expired' ? 'session_expired' : base.error_code,
      reasons: base.reasons,
    });
  }
  if (data?.error || data?.success !== true) {
    const base = edgeFunctionError(data);
    throw new LoginCredentialsError('unknown', base.message, { error_code: base.error_code, reasons: base.reasons });
  }
  return { success: true, message: typeof data.message === 'string' ? data.message : '' };
}
