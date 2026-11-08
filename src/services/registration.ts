import { currentLangCode, translate } from '@/i18n/core';
import { COUNTRIES } from '@/config/countries';
import { supabase } from '@/lib/supabase';
import { specKey } from '@/services/specializationCatalog';
import { edgeFunctionError, pwnedPasswordMessage, authErrorMessage } from '@/utils/authError';

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
    phone: input.phone,
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

  const phone = input.phone?.trim();
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
