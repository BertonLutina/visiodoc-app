import { en } from './locales/en';
import { sw } from './locales/sw';
import { ln } from './locales/ln';

/**
 * i18n « gettext » : le texte français est la clé. `t('Se connecter')` renvoie le texte
 * traduit dans la langue active, ou le français si la traduction manque (jamais de clé brute).
 * Interpolation : `t('Bonjour {name}', { name })`.
 */
export type LangCode = 'fr' | 'en' | 'sw' | 'ln';
export type Vars = Record<string, string | number>;

/** Libellé de langue (tel que stocké dans users.preferred_language) → code traduit. */
const CODE_BY_LABEL: Record<string, LangCode> = {
  français: 'fr',
  francais: 'fr',
  french: 'fr',
  english: 'en',
  anglais: 'en',
  swahili: 'sw',
  kiswahili: 'sw',
  lingala: 'ln',
};

/** Langues réellement traduites, dans l'ordre d'affichage. */
export const TRANSLATED_LANGUAGES = ['Français', 'English', 'Swahili', 'Lingala'];

const DICTIONARIES: Record<Exclude<LangCode, 'fr'>, Record<string, string>> = { en, sw, ln };

const LOCALE_BY_CODE: Record<LangCode, string> = {
  fr: 'fr-FR',
  en: 'en-GB',
  sw: 'sw-KE',
  ln: 'fr-CD',
};

export const LANGUAGE_STORAGE_KEY = 'visiodoc.language';

export function langCodeFor(label?: string | null): LangCode {
  if (!label) return 'fr';
  return CODE_BY_LABEL[label.trim().toLowerCase()] ?? 'fr';
}

/** Vrai si l'interface existe réellement dans cette langue (sinon : repli sur le français). */
export function isTranslatedLanguage(label?: string | null): boolean {
  if (!label) return false;
  return label.trim().toLowerCase() in CODE_BY_LABEL;
}

/** Langues proposées : celles du pays + English, les langues traduites en premier. */
export function languageOptions(countryLanguages: string[]): string[] {
  const all = [...TRANSLATED_LANGUAGES];
  for (const l of countryLanguages) if (!all.some((x) => x.toLowerCase() === l.toLowerCase())) all.push(l);
  return all;
}

/** Locale Intl pour les dates/nombres, ex: 'fr-FR'. */
export function localeFor(code: LangCode): string {
  return LOCALE_BY_CODE[code];
}

/** Locale Intl de la langue active — dates et nombres hors composant. */
export function appLocale(): string {
  return LOCALE_BY_CODE[currentCode];
}

export function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// Langue active, lisible hors composants (services, utils) ; mise à jour par LanguageProvider.
let currentCode: LangCode = 'fr';

export function currentLangCode(): LangCode {
  return currentCode;
}

/** Traduit hors composant (services, utils, constantes évaluées à l'appel). */
export function translate(text: string, vars?: Vars, code: LangCode = currentCode): string {
  const raw = code === 'fr' ? text : DICTIONARIES[code][text] ?? text;
  return interpolate(raw, vars);
}

/** Mis à jour par LanguageProvider (et par les tests). */
export function setCurrentLangCode(code: LangCode) {
  currentCode = code;
}

