import { currentLangCode, translate } from '@/i18n/core';
import { COUNTRIES, countryUsesPostnom } from '@/config/countries';
import { identityNamesIssue } from '@/utils/identityNames';
import { getAfricanCountry } from '@/config/africanCountries';
import { toE164 } from '@/utils/phone';
import { supabase } from '@/lib/supabase';
import { specKey } from '@/services/specializationCatalog';
import { edgeFunctionError, pwnedPasswordMessage, authErrorMessage, readHttpError } from '@/utils/authError';
import { passwordIssue, passwordIssueMessage } from '@/services/passwordPolicy';
import { birthDateIssue, birthDateMessage, normalizePlace } from '@/utils/birthDate';
import {
  clearCredentialsPending,
  hasSubmittedCredentials,
  markCredentialsPending,
  markCredentialsSubmitted,
} from '@/services/loginCredentialsFlag';

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

/** Refus d'âge renvoyé par `register-patient` (mineur ou plus de 125 ans). */
export const UNDERAGE_SERVER_MESSAGE = 'Vous devez avoir au moins 18 ans révolus pour vous inscrire.';

/** 400 du serveur : champ obligatoire manquant (ville, entre autres). */
export const REQUIRED_FIELD_SERVER_MESSAGE = 'Champ obligatoire.';
/** 400 du serveur : pays à post-nom, ni prénom ni post-nom. */
export const FIRST_OR_POSTNOM_SERVER_MESSAGE = 'Le prénom ou le post-nom est obligatoire.';
/** 400 du serveur (et erreur base `COUNTRY_NOT_OPEN`) : pays non ouvert aux inscriptions. */
export const COUNTRY_NOT_OPEN_MESSAGE = "Visiodoc n'est pas encore disponible dans ce pays.";

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
  if (status === 400) {
    // 400 « Required » : un champ obligatoire manque (le serveur ne dit pas lequel). Refus d'âge = texte du serveur.
    if (body?.error === 'Required') {
      return new RegisterPatientError(
        kind,
        edgeFunctionError({ error: translate('Un champ obligatoire est manquant. Vérifie le formulaire.') }),
      );
    }
    // Contrats figés (MOB-1811-1/3/5) : textes serveur connus, toujours affichés traduits.
    if (body?.error === REQUIRED_FIELD_SERVER_MESSAGE) {
      return new RegisterPatientError(
        kind,
        edgeFunctionError({ error: translate('Un champ obligatoire est manquant. Vérifie le formulaire.') }),
      );
    }
    if (body?.error === FIRST_OR_POSTNOM_SERVER_MESSAGE) {
      return new RegisterPatientError(kind, edgeFunctionError({ error: translate(FIRST_OR_POSTNOM_SERVER_MESSAGE) }));
    }
    if (body?.error === COUNTRY_NOT_OPEN_MESSAGE) {
      return new RegisterPatientError(kind, edgeFunctionError({ error: translate(COUNTRY_NOT_OPEN_MESSAGE) }));
    }
    if (body?.error === UNDERAGE_SERVER_MESSAGE) {
      return new RegisterPatientError(kind, edgeFunctionError({ error: translate(UNDERAGE_SERVER_MESSAGE) }));
    }
  }
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
  /** Post-nom (pays congolais, `users.post_nom`). Facultatif (100 caractères au plus), pris en compte par le serveur seulement si `countries.uses_postnom`. */
  postNom?: string;
  /** Volontairement large : validé à l'exécution (male / female uniquement). */
  gender?: string | null;
  phone?: string;
  /** Code ISO du pays choisi, ex. 'CD'. */
  countryCode?: string;
  /** `AAAA-MM-JJ`, obligatoire, 18 ans révolus (contrôlé avant l'appel). */
  dateOfBirth: string;
  /** Ville obligatoire (100 caractères au plus) ; commune facultative. */
  city?: string;
  commune?: string;
}

/**
 * `POST /functions/v1/register-patient` (jeton anonyme géré par `functions.invoke`).
 * Succès : le compte existe mais n'est PAS connecté, l'e-mail de confirmation est parti.
 *
 * - `gender` et `dateOfBirth` (18 ans révolus) : vérifiés AVANT tout appel réseau.
 * - `city` obligatoire (refus avant l'appel si vide) ; `commune` facultative, omise si vide.
 * - noms : `identityNamesIssue` (post-nom pour CD) ; `firstName` peut être vide si `postNom` est rempli ; `postNom`
 *   est rogné et omis s'il est vide.
 * - `countryId` : UUID du pays choisi si l'app le connaît (`COUNTRIES[code].id`), sinon omis
 *   (le serveur choisit la RDC). Jamais de repli silencieux ni de premier pays d'une liste.
 */
export async function registerPatientAccount(
  input: RegisterPatientAccountInput,
): Promise<{ requiresEmailConfirmation: true }> {
  if (!isGender(input.gender)) {
    throw new Error(translate('Choisis ton genre : Masculin ou Féminin.'));
  }
  const namesIssue = identityNamesIssue(input, countryUsesPostnom(input.countryCode));
  if (namesIssue) throw new Error(namesIssue);
  const dobIssue = birthDateIssue(input.dateOfBirth);
  if (dobIssue) throw new Error(birthDateMessage(dobIssue));
  const city = normalizePlace(input.city);
  if (city === null) throw new Error(translate('La ville ne doit pas dépasser 100 caractères.'));
  if (!city) throw new Error(translate('La ville est obligatoire.'));
  const commune = normalizePlace(input.commune);
  if (commune === null) throw new Error(translate('La commune ne doit pas dépasser 100 caractères.'));
  if (!supabase) throw new Error(translate('Backend non configuré.'));

  const phone = toE164(input.phone, dialCodeFor(input.countryCode));
  // `register-patient` exige le téléphone (phoneE164Schema) : sans lui, le serveur répond 400 « Required ».
  if (!phone) throw new Error(translate('Le numéro de téléphone est obligatoire.'));
  const countryId = input.countryCode ? COUNTRIES[input.countryCode]?.id : undefined;
  const language = serverLanguage();
  const postNom = input.postNom?.trim();
  const body = {
    email: input.email.trim().toLowerCase(),
    password: input.password,
    firstName: input.firstName,
    lastName: input.lastName,
    ...(postNom ? { postNom } : {}),
    gender: input.gender,
    dateOfBirth: input.dateOfBirth.trim(),
    ...(city ? { city } : {}),
    ...(commune ? { commune } : {}),
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
 * Étape 8 du guide : un compte créé par téléphone (OTP WhatsApp) reçoit un e-mail et un mot de passe
 * via l'Edge Function `set-login-credentials` (backend ce92d3b).
 *
 * Comportement réel du backend : le mot de passe est fixé tout de suite ; l'e-mail est seulement
 * enregistré dans `pending_login_emails` et un lien de confirmation lui est envoyé ; `auth.users.email`
 * n'est écrit qu'au clic sur ce lien (`confirm-login-email`).
 * ---------------------------------------------------------------------------------------------- */

/** Domaine factice des comptes créés par téléphone (backend `PHONE_PLACEHOLDER_DOMAIN`). */
const PHONE_PLACEHOLDER_DOMAIN = '@phone.visiodoc.local';

/**
 * Reprend la règle du backend `hasNoLoginEmail` : l'e-mail d'authentification est vide / absent OU se
 * termine par `@phone.visiodoc.local` (insensible à la casse). `submitted` = le drapeau
 * `credentialsSubmitted:<userId>` existe (étape déjà envoyée, e-mail en attente de confirmation) → faux,
 * pour ne pas reboucler tant que le lien n'est pas cliqué.
 *
 * Demandée uniquement juste après une connexion par code (jamais à la restauration de session).
 */
export function needsLoginCredentials(
  authUser: { id?: string; phone?: string | null; email?: string | null } | null | undefined,
  submitted = false,
): boolean {
  if (!authUser || submitted) return false;
  const email = (authUser.email ?? '').trim().toLowerCase();
  return email === '' || email.endsWith(PHONE_PLACEHOLDER_DOMAIN);
}

/** Règle + drapeau persistant de l'utilisateur. */
export async function shouldAskLoginCredentials(
  authUser: { id?: string; phone?: string | null; email?: string | null } | null | undefined,
): Promise<boolean> {
  if (!authUser) return false;
  return needsLoginCredentials(authUser, await hasSubmittedCredentials(authUser.id ?? ''));
}

/**
 * À appeler juste après un code valide : si l'étape e-mail + mot de passe est due, pose le marqueur
 * `credentialsPending:<userId>` AVANT de rendre la main (la session est déjà persistée : sans marqueur,
 * un redémarrage l'ouvrirait sans identifiants). Sinon efface un marqueur périmé. Renvoie « étape due ».
 */
export async function requireLoginCredentialsStep(
  authUser: { id?: string; phone?: string | null; email?: string | null } | null | undefined,
): Promise<boolean> {
  const id = authUser?.id ?? '';
  const needed = await shouldAskLoginCredentials(authUser);
  if (needed) await markCredentialsPending(id);
  else await clearCredentialsPending(id);
  return needed;
}

export type LoginCredentialsErrorKind =
  | 'invalid_email'
  | 'weak_password'
  | 'password_mismatch'
  | 'validation'
  | 'conflict'
  | 'already_has_login_email'
  | 'rate_limited'
  | 'email_failed'
  | 'session_expired'
  | 'unknown';

/** Erreur de `setLoginCredentials` : contrôle client (avant tout appel) ou réponse HTTP de la fonction. */
export class LoginCredentialsError extends Error {
  kind: LoginCredentialsErrorKind;
  /** `code` du corps `{ success: false, code, error }` du backend (ex. `EMAIL_TAKEN`). */
  code?: string;
  error_code?: string;
  /** Texte `error` du corps de la réponse, s'il y en a un (sinon `message` est un texte de repli). */
  serverMessage?: string;

  constructor(
    kind: LoginCredentialsErrorKind,
    message: string,
    extra?: { code?: string; error_code?: string; serverMessage?: string },
  ) {
    super(message);
    this.name = 'LoginCredentialsError';
    this.kind = kind;
    if (extra?.code) this.code = extra.code;
    if (extra?.error_code) this.error_code = extra.error_code;
    if (extra?.serverMessage) this.serverMessage = extra.serverMessage;
  }
}

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Statut HTTP + `code` du backend → type d'erreur. */
const credentialsKind = (status: number | undefined, code: string | undefined): LoginCredentialsErrorKind => {
  if (status === 401) return 'session_expired';
  if (status === 409) return code === 'ALREADY_HAS_LOGIN_EMAIL' ? 'already_has_login_email' : 'conflict';
  if (status === 429) return 'rate_limited';
  if (status === 502) return 'email_failed';
  if (status === 400) {
    if (code === 'WEAK_PASSWORD') return 'weak_password';
    if (code === 'INVALID_EMAIL') return 'invalid_email';
    if (code === 'PASSWORD_MISMATCH') return 'password_mismatch';
    return 'validation';
  }
  return 'unknown';
};

/** Message affiché pour une erreur de `setLoginCredentials` (français, via `translate`). */
export function loginCredentialsErrorMessage(error: any): string {
  if (!(error instanceof LoginCredentialsError)) return authErrorMessage(error);
  switch (error.kind) {
    case 'session_expired':
      return translate('Ta session a expiré, reconnecte-toi.');
    case 'conflict':
      return translate('Un compte existe déjà avec cet email.');
    case 'already_has_login_email':
      return translate('Un e-mail de connexion est déjà associé à ce compte.');
    case 'rate_limited':
      return translate('Trop de tentatives. Réessaie dans quelques minutes.');
    case 'invalid_email':
      return translate('Adresse email invalide.');
    case 'password_mismatch':
      return translate('Les mots de passe ne correspondent pas.');
    case 'weak_password':
      // `WEAK_PASSWORD` du serveur (liste noire, e-mail, nom… que le client ne peut pas connaître) : son texte
      // français tel quel, sinon le message commun. Contrôle client : la règle précise.
      if (error.code === 'WEAK_PASSWORD') {
        return (
          error.serverMessage ??
          translate('Le mot de passe doit comporter au moins 10 caractères et inclure au moins une lettre et un chiffre.')
        );
      }
      return error.message;
    case 'unknown':
      return translate('Une erreur est survenue. Réessaie.');
    default:
      // Texte français du serveur tel quel (400 générique, 502 e-mail non envoyé).
      return error.message;
  }
}

/**
 * `POST /functions/v1/set-login-credentials` avec la session de l'utilisateur (l'en-tête
 * `Authorization: Bearer` est ajouté par supabase-js). Corps : `{ email, newPassword, confirmPassword }`.
 * Succès réel : `{ success: true, pending: true, email }` — l'e-mail doit encore être confirmé par lien.
 *
 * Contrôles AVANT tout appel réseau : format de l'e-mail, politique de mot de passe commune
 * (10–72, lettre + chiffre) puis égalité de la confirmation. Le mot de passe n'est ni journalisé ni
 * conservé.
 */
export async function setLoginCredentials(
  email: string,
  newPassword: string,
  confirmPassword: string,
): Promise<{ success: true; pending: boolean; email: string }> {
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
    const code = typeof body?.code === 'string' ? body.code : undefined;
    const kind = credentialsKind(status, code);
    const base = edgeFunctionError(body);
    throw new LoginCredentialsError(kind, base.message, {
      code,
      serverMessage: typeof body?.error === 'string' && body.error ? body.error : undefined,
      // 401 : toujours traité comme session expirée (voie Task 6, `isSessionExpiry`).
      error_code: kind === 'session_expired' ? 'session_expired' : base.error_code,
    });
  }
  if (data?.success !== true) {
    throw new LoginCredentialsError('unknown', edgeFunctionError(data).message);
  }
  return {
    success: true,
    pending: data.pending === true,
    email: typeof data.email === 'string' && data.email ? data.email : cleanEmail,
  };
}

export type LoginCredentialsOutcome = {
  /** `pending_confirmation` : lien envoyé à `email` ; `already_has_login_email` : le compte avait déjà un e-mail. */
  status: 'pending_confirmation' | 'already_has_login_email';
  email: string;
};

/**
 * `setLoginCredentials` + drapeau persistant `credentialsSubmitted:<userId>` (étape non reproposée).
 * `ALREADY_HAS_LOGIN_EMAIL` vaut succès pour le parcours : drapeau posé, l'utilisateur peut entrer.
 */
export async function submitLoginCredentials(
  userId: string,
  email: string,
  newPassword: string,
  confirmPassword: string,
): Promise<LoginCredentialsOutcome> {
  try {
    const result = await setLoginCredentials(email, newPassword, confirmPassword);
    await markCredentialsSubmitted(userId);
    await clearCredentialsPending(userId);
    return { status: 'pending_confirmation', email: result.email };
  } catch (e) {
    if (e instanceof LoginCredentialsError && e.kind === 'already_has_login_email') {
      await markCredentialsSubmitted(userId);
      await clearCredentialsPending(userId);
      return { status: 'already_has_login_email', email: email.trim().toLowerCase() };
    }
    throw e;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Temporisation du renvoi du code OTP : un état par numéro E.164, au niveau du module (survit au
 * démontage de l'écran ; un envoi au numéro A ne bloque pas le numéro B).
 * ---------------------------------------------------------------------------------------------- */

const lastCodeSentAt = new Map<string, number>();

/** Note l'envoi d'un code au numéro `phone` (E.164) à l'instant `now` (ms). */
export function markCodeSent(phone: string, now: number = Date.now()): void {
  if (!phone) return;
  lastCodeSentAt.set(phone, now);
  // Les entrées expirées n'ont plus d'effet : on les retire pour borner la mémoire.
  for (const [key, at] of lastCodeSentAt) {
    if (resendCooldownRemaining(at, now) === 0) lastCodeSentAt.delete(key);
  }
}

/** Secondes avant de pouvoir renvoyer un code à ce numéro (0 = possible). */
export function codeCooldownRemaining(phone: string, now: number = Date.now()): number {
  if (!phone) return 0;
  return resendCooldownRemaining(lastCodeSentAt.get(phone) ?? null, now);
}

/** Réservé aux tests. */
export function resetCodeCooldowns(): void {
  lastCodeSentAt.clear();
}
