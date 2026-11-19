import { en } from './locales/en';
import { sw } from './locales/sw';
import { ln } from './locales/ln';
import {
  interpolate,
  isTranslatedLanguage,
  langCodeFor,
  languageOptions,
  setCurrentLangCode,
  translate,
} from './core';
import {
  PROVIDER_INCOMPLETE_MESSAGE,
  PROVIDER_PENDING_MESSAGE,
  PROVIDER_REJECTED_MESSAGE,
  PROVIDER_SUSPENDED_MESSAGE,
} from '@/utils/authError';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');
const ROOT: string = path.resolve(process.cwd());

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir) as string[]) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Tous les littéraux passés à t('…') / translate('…') dans le code de l'app. */
function usedKeys(): string[] {
  const files = [...walk(path.join(ROOT, 'app')), ...walk(path.join(ROOT, 'src'))].filter(
    (f) => !f.includes(`${path.sep}i18n${path.sep}`),
  );
  const pat = /\b(?:t|translate)\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
  const keys = new Set<string>();
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(pat)) {
      keys.add((m[1] ?? m[2]).replace(/\\'/g, "'").replace(/\\"/g, '"'));
    }
  }
  return [...keys];
}

// Textes passés à t() via une variable (constantes, tableaux de libellés).
const DYNAMIC_KEYS = [
  PROVIDER_PENDING_MESSAGE, PROVIDER_REJECTED_MESSAGE, PROVIDER_INCOMPLETE_MESSAGE, PROVIDER_SUSPENDED_MESSAGE,
  'Hebdomadaire', 'Exceptions & Congés', 'Réglages',
  'Connexion classique', 'Lien magique par email', 'Sans mot de passe', 'Numéro de téléphone',
  'Code de vérification par SMS', 'Email et mot de passe',
  'Consulter', 'Prestataires dispo.', 'Historique médical', 'Recharger, payer', 'IA Médicale', 'Analyse symptômes',
  'Prestataire', 'Dossiers', 'Wallet', 'RDV',
  'Tous', 'Généraliste', 'Pédiatrie', 'Cardio', 'Gynéco', 'Tout',
  'Confirmée', 'En attente', 'En cours', 'Terminée', 'Annulée',
  'Vidéo', 'Chat', 'Tél.', 'Téléphone',
  'Dispo auj.', 'Sur RDV', 'Demain dispo',
  'Médecine générale', 'Cardiologie', 'Gynécologie',
  'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim',
  'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche',
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
  'Rappels de rendez-vous', 'Avant chaque consultation programmée', 'Résultats & ordonnances',
  'Quand un document est ajouté à votre dossier', 'Promotions & nouveautés', 'Offres et actualités VisioDoc',
  'Recharger', 'Envoyer', 'Historique', 'Recharge M-Pesa', 'Consult. Dr. Diallo', 'Recharge Airtel Money',
  'Modifier le profil', 'Dossier médical', 'Portefeuille', 'Notifications', 'Aide & Support',
  'Mon profil', 'Infos personnelles', 'Spécialisation', 'Tarif consultation', 'Disponibilités',
  'Lun–Ven · 9h–18h', 'Plan annuel · Actif', 'Analyse IA', 'Bientôt disponible',
  'Congés', 'Tarif', 'Patients', 'Abonnement',
  "Durée d'un rendez-vous", 'Temps réservé pour chaque consultation.', 'Intervalle entre créneaux',
  'À quelle fréquence un nouveau créneau peut démarrer.',
  '0 min enchaîne les créneaux sans écart. Les autres valeurs espacent le début de chaque créneau.',
  'Tampon avant',
  'Temps de battement avant chaque rendez-vous.', 'Tampon après', 'Temps de battement après chaque rendez-vous.',
  'Préavis minimum', "Délai minimum avant qu'un patient puisse réserver.", 'Horizon de réservation',
  "Nombre de jours à l'avance réservables.", 'min', 'jours',
  'Plan Annuel', 'Plan Mensuel', '/ an', '/ mois', 'Économisez 24%',
  'Consultations vidéo illimitées', 'Consultations audio illimitées', 'Gestion patients & dossiers',
  'Gestion des disponibilités', 'Accès sécurisé à la plateforme', 'Mêmes fonctionnalités',
  'Allergie', 'Traitement en cours', 'Ordonnance', 'Pathologie', 'Vaccination', 'Résultat labo',
  'Document', 'Note', 'Compte-rendu',
];

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');

describe('i18n dictionaries', () => {
  const keys = [...new Set([...usedKeys(), ...DYNAMIC_KEYS])];

  it.each([
    ['English', en],
    ['Swahili', sw],
    ['Lingala', ln],
  ])('%s covers every translated string used by the app', (_name, dict) => {
    const missing = keys.filter((k) => !(k in dict));
    expect(missing).toEqual([]);
  });

  it.each([
    ['English', en],
    ['Swahili', sw],
    ['Lingala', ln],
  ])('%s keeps the same {placeholders} as the French source', (_name, dict) => {
    const broken = Object.entries(dict)
      .filter(([fr, tr]) => placeholders(fr) !== placeholders(tr))
      .map(([fr]) => fr);
    expect(broken).toEqual([]);
  });
});

describe('translate()', () => {
  afterEach(() => setCurrentLangCode('fr'));

  it('returns the French text by default', () => {
    expect(translate('Se connecter')).toBe('Se connecter');
  });

  it('translates into the active language and interpolates', () => {
    setCurrentLangCode('en');
    expect(translate('Se connecter')).toBe('Sign in');
    expect(translate('Bonjour {name}', { name: 'Marie' })).toBe('Hello Marie');
    setCurrentLangCode('sw');
    expect(translate('Se connecter')).toBe('Ingia');
  });

  it('falls back to French for an unknown key', () => {
    setCurrentLangCode('ln');
    expect(translate('Texte inexistant {x}', { x: 1 })).toBe('Texte inexistant 1');
  });

  it('interpolate leaves unknown placeholders untouched', () => {
    expect(interpolate('{a} {b}', { a: 1 })).toBe('1 {b}');
  });
});

describe('language helpers', () => {
  it('maps language labels to codes (case/accents tolerant), defaulting to French', () => {
    expect(langCodeFor('English')).toBe('en');
    expect(langCodeFor('lingala')).toBe('ln');
    expect(langCodeFor('Swahili')).toBe('sw');
    expect(langCodeFor('Kikongo')).toBe('fr');
    expect(langCodeFor(undefined)).toBe('fr');
  });

  it('flags which languages really exist in the UI', () => {
    expect(isTranslatedLanguage('Lingala')).toBe(true);
    expect(isTranslatedLanguage('Tshiluba')).toBe(false);
  });

  it('offers the translated languages first, then the country-specific ones', () => {
    expect(languageOptions(['Français', 'Lingala', 'Swahili', 'Kikongo', 'Tshiluba'])).toEqual([
      'Français', 'English', 'Swahili', 'Lingala', 'Kikongo', 'Tshiluba',
    ]);
    expect(languageOptions(['Français', 'Haoussa', 'Zarma'])).toEqual([
      'Français', 'English', 'Swahili', 'Lingala', 'Haoussa', 'Zarma',
    ]);
  });
});

describe('provider notices are translated (no mock fee / subscription content)', () => {
  it.each([
    "La gestion du tarif sera bientôt disponible dans l'application.",
    "L'abonnement sera bientôt disponible dans l'application. Ton accès est limité en attendant.",
    'Retour',
  ])('has en, sw and ln for %s', (key) => {
    for (const dict of [en, sw, ln]) {
      expect(typeof dict[key]).toBe('string');
      expect(dict[key]).not.toBe(key);
    }
  });
});
