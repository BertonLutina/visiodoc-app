import { translate } from '@/i18n/core';

/** Âge minimum d'un compte patient (guide MOB-1211-1) : 18 ans révolus. */
export const MIN_PATIENT_AGE = 18;
/** Au-delà, le serveur refuse aussi (même message que pour un mineur). */
export const MAX_PATIENT_AGE = 125;
/** Longueur maximale de `city` et `commune` à l'inscription. */
export const MAX_PLACE_LENGTH = 100;

export type BirthDateIssue = 'required' | 'invalid' | 'underage';

const pad = (n: number) => String(n).padStart(2, '0');

/** Découpe `AAAA-MM-JJ` en nombres, ou `null` si le format ou le calendrier est faux (ex. 2001-02-30). */
export function parseIsoDate(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return { y, m, d };
}

/** Âge en années révolues à la date `today` (heure locale). */
export function ageOn(dob: { y: number; m: number; d: number }, today: Date): number {
  let age = today.getFullYear() - dob.y;
  const month = today.getMonth() + 1;
  if (month < dob.m || (month === dob.m && today.getDate() < dob.d)) age -= 1;
  return age;
}

/**
 * Contrôle de la date de naissance d'un patient, comme le serveur : obligatoire, 18 ans révolus au
 * moins, 125 ans au plus. Une date future (âge négatif) est traitée comme un mineur.
 */
export function birthDateIssue(value: string | null | undefined, today: Date = new Date()): BirthDateIssue | null {
  const raw = (value ?? '').trim();
  if (!raw) return 'required';
  const dob = parseIsoDate(raw);
  if (!dob) return 'invalid';
  const age = ageOn(dob, today);
  if (age < MIN_PATIENT_AGE || age > MAX_PATIENT_AGE) return 'underage';
  return null;
}

export const isAtLeast18 = (value: string | null | undefined, today?: Date): boolean =>
  birthDateIssue(value, today) === null;

/** Message affiché (texte du serveur pour le mineur). */
export function birthDateMessage(issue: BirthDateIssue): string {
  if (issue === 'required') return translate('La date de naissance est obligatoire.');
  if (issue === 'invalid') return translate('Date de naissance invalide.');
  return translate('Vous devez avoir au moins 18 ans révolus pour vous inscrire.');
}

/** Dernière date de naissance permise aujourd'hui (pour borner le sélecteur de date). */
export function latestBirthDate(today: Date = new Date()): string {
  const y = today.getFullYear() - MIN_PATIENT_AGE;
  // 29 février : une personne née ce jour-là a 18 ans le 1er mars d'une année non bissextile.
  const probe = new Date(y, today.getMonth(), today.getDate());
  return `${probe.getFullYear()}-${pad(probe.getMonth() + 1)}-${pad(probe.getDate())}`;
}

/** Texte facultatif (ville, commune) : rogné ; vide → `undefined` ; trop long → `null`. */
export function normalizePlace(value: string | null | undefined): string | undefined | null {
  const v = (value ?? '').trim();
  if (!v) return undefined;
  return v.length > MAX_PLACE_LENGTH ? null : v;
}
