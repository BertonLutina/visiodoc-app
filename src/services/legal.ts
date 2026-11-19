import { Share } from 'react-native';
import { supabase } from '@/lib/supabase';
import { translate } from '@/i18n/core';
import { LEGAL_PLATFORM, LEGAL_VERSIONS } from '@/config/legalVersions';
import { readHttpError } from '@/utils/authError';

/* ------------------------------------------------------------------------------------------------
 * MOB-1811-6 : preuve d'acceptation des textes juridiques, export des données, demande de suppression.
 * ---------------------------------------------------------------------------------------------- */

/** Pages du site web (ouvertes dans le navigateur), mécanisme déjà utilisé par `LegalAccountSection`. */
export const LEGAL_WEB_BASE = 'https://cd.visiodoc.online/';
export type LegalPage = 'conditions' | 'confidentialite' | 'mentions';
export const legalUrl = (page: LegalPage): string => `${LEGAL_WEB_BASE}?legal=${page}`;

export type LegalRole = 'patient' | 'provider';

export interface LegalAcceptancePayload {
  cguVersion: string;
  privacyVersion: string;
  healthConsent?: true;
  healthConsentVersion?: string;
  platform: typeof LEGAL_PLATFORM;
}

/** Champ `legalAcceptance` de `register-patient` / `register-presta` (consentement santé : patient seulement). */
export function buildLegalAcceptance(role: LegalRole, healthConsent = false): LegalAcceptancePayload {
  if (role === 'patient') {
    return {
      cguVersion: LEGAL_VERSIONS.cguPatient,
      privacyVersion: LEGAL_VERSIONS.privacy,
      ...(healthConsent ? { healthConsent: true as const, healthConsentVersion: LEGAL_VERSIONS.healthConsent } : {}),
      platform: LEGAL_PLATFORM,
    };
  }
  return { cguVersion: LEGAL_VERSIONS.cguPro, privacyVersion: LEGAL_VERSIONS.privacy, platform: LEGAL_PLATFORM };
}

/** Message du contrôle avant tout appel réseau, ou `null` : un patient doit avoir coché la case. */
export function healthConsentIssue(healthConsent: boolean | undefined): string | null {
  return healthConsent === true
    ? null
    : translate('Le consentement au traitement des données de santé est obligatoire pour créer un compte patient.');
}

/** Textes serveur (HTTP 400, guide MOB-1811-6) → message traduit, sinon `null`. */
export function legalServerErrorMessage(serverMessage: unknown): string | null {
  switch (serverMessage) {
    case "Vous devez accepter les conditions d'utilisation.":
      return translate("Vous devez accepter les conditions d'utilisation.");
    case 'Vous devez donner votre consentement au traitement de vos données de santé.':
      return translate('Vous devez donner votre consentement au traitement de vos données de santé.');
    case "Les informations d'acceptation des conditions sont invalides.":
      return translate("Les informations d'acceptation des conditions sont invalides.");
    default:
      return null;
  }
}

/**
 * Découpe un texte contenant des {jetons} en segments (texte ou lien), pour afficher une phrase dont
 * certains mots sont des liens, quelle que soit la langue (l'ordre des jetons peut changer).
 */
export type TemplatePart = { type: 'text'; text: string } | { type: 'token'; name: string };
export function splitTemplate(template: string, tokens: string[]): TemplatePart[] {
  const parts: TemplatePart[] = [];
  const re = new RegExp(`\\{(${tokens.join('|')})\\}`, 'g');
  let last = 0;
  for (const m of template.matchAll(re)) {
    const index = m.index ?? 0;
    if (index > last) parts.push({ type: 'text', text: template.slice(last, index) });
    parts.push({ type: 'token', name: m[1] });
    last = index + m[0].length;
  }
  if (last < template.length) parts.push({ type: 'text', text: template.slice(last) });
  return parts;
}

/** Journalise un échec par son code seul (jamais le message de la base). */
export function logErrorCode(scope: string, error: unknown): void {
  const e = error as { code?: unknown; status?: unknown } | null | undefined;
  const code = typeof e?.code === 'string' ? e.code : typeof e?.status === 'number' ? String(e.status) : 'unknown';
  console.warn(`[legal:${scope}] ${code}`);
}

/* ---------------------------- Preuve d'acceptation (parcours téléphone) ---------------------------- */

/**
 * Parcours téléphone : le compte n'est pas créé par `register-patient`, la preuve est donc écrite par la RPC
 * `record_legal_acceptance` (CGU patient, confidentialité, consentement santé). Une erreur BLOQUE l'inscription :
 * c'est la preuve légale, mieux vaut redemander que de laisser un compte sans preuve.
 */
export async function recordPhoneSignupAcceptances(): Promise<void> {
  if (!supabase) return;
  const documents: [string, string][] = [
    ['cgu_patient', LEGAL_VERSIONS.cguPatient],
    ['privacy', LEGAL_VERSIONS.privacy],
    ['health_consent', LEGAL_VERSIONS.healthConsent],
  ];
  for (const [document, version] of documents) {
    let error: unknown = null;
    try {
      ({ error } = await supabase.rpc('record_legal_acceptance', {
        p_document: document,
        p_version: version,
        p_context: 'signup',
        p_platform: LEGAL_PLATFORM,
      }));
    } catch (e) {
      error = e;
    }
    if (error) {
      logErrorCode('record', error);
      throw new Error(translate("Ton acceptation n'a pas pu être enregistrée. Réessaie dans un instant."));
    }
  }
}

/* ---------------------------------- Retrait du consentement santé ---------------------------------- */

/** Retire le consentement santé ; renvoie le nombre de consentements actifs retirés (0 = aucun). */
export async function withdrawHealthConsent(): Promise<number> {
  if (!supabase) throw new Error(translate('Backend non configuré.'));
  const { data, error } = await supabase.rpc('withdraw_legal_acceptance', { p_document: 'health_consent' });
  if (error) {
    logErrorCode('withdraw', error);
    throw new Error(translate("Le retrait n'a pas pu être enregistré. Réessayez dans un instant."));
  }
  return typeof data === 'number' ? data : 0;
}

/* ------------------------------------------ Suppression ------------------------------------------ */

export type DeletionOutcome = 'created' | 'already_pending';

/** `request_account_deletion` : n'efface rien, ouvre une demande traitée par un humain sous 30 jours. */
export async function requestAccountDeletion(): Promise<DeletionOutcome> {
  if (!supabase) throw new Error(translate('Backend non configuré.'));
  const { error } = await supabase.rpc('request_account_deletion', { p_reason: null });
  if (error) {
    if ((error as { code?: string }).code === '23505') return 'already_pending';
    logErrorCode('deletion', error);
    throw new Error(translate("La demande n'a pas pu être envoyée. Réessayez dans un instant."));
  }
  return 'created';
}

/* -------------------------------------------- Export -------------------------------------------- */

/** `export-my-data` (jeton de session ajouté par `functions.invoke`), 3 appels par jour : 429 RATE_LIMITED. */
export async function exportMyData(): Promise<unknown> {
  if (!supabase) throw new Error(translate('Backend non configuré.'));
  const { data, error } = await supabase.functions.invoke('export-my-data', { method: 'POST' });
  if (error) {
    const { status } = await readHttpError(error);
    logErrorCode('export', { status });
    if (status === 429) {
      throw new Error(translate('Vous avez atteint la limite de 3 exports par jour. Réessayez demain.'));
    }
    throw new Error(translate("L'export n'a pas pu être généré. Réessayez dans un instant."));
  }
  if (!data || typeof data !== 'object') {
    throw new Error(translate("L'export n'a pas pu être généré. Réessayez dans un instant."));
  }
  return data;
}

/** Nom du fichier d'export (titre de la feuille de partage ; le JSON est partagé en texte). */
export const exportFileName = (date = new Date()): string =>
  `visiodoc-mes-donnees-${date.toISOString().slice(0, 10)}.json`;

/** Partage le JSON avec la feuille de partage du système (enregistrer, envoyer, copier). */
export async function shareExport(data: unknown): Promise<void> {
  await Share.share({ title: exportFileName(), message: JSON.stringify(data, null, 2) });
}
