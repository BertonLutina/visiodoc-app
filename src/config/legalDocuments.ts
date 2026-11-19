import { LEGAL_VERSIONS } from '@/config/legalVersions';
import type { LegalPage } from '@/services/legal';

/**
 * Registre des textes juridiques lisibles dans l'application.
 * `statut: 'pending'` : le contenu n'est pas encore fourni, l'écran affiche un texte de substitution
 * et renvoie vers le site. Passer à `'ready'` en renseignant `contenu` (texte simple : paragraphes séparés par
 * une ligne vide, titres en lignes commençant par `#`, listes en lignes commençant par `- `).
 */
export type LegalDocSlug =
  | 'cgu-patient'
  | 'cgu-pro'
  | 'confidentialite'
  | 'cookies'
  | 'mentions'
  | 'declaration-enfant'
  | 'securite';

export interface LegalDocument {
  slug: LegalDocSlug;
  titre: string;
  version: string;
  /** Date d'entrée en vigueur (AAAA-MM-JJ), `null` tant que le texte n'est pas finalisé. */
  date: string | null;
  statut: 'pending' | 'ready';
  contenu?: string;
  /** Page du site ouverte par le bouton de secours. */
  webPage: LegalPage;
}


export const LEGAL_DOCUMENTS: LegalDocument[] = [
  { slug: 'cgu-patient', titre: "Conditions d'utilisation patient", version: LEGAL_VERSIONS.cguPatient, date: null, statut: 'pending', webPage: 'conditions' },
  { slug: 'cgu-pro', titre: "Conditions d'utilisation prestataire", version: LEGAL_VERSIONS.cguPro, date: null, statut: 'pending', webPage: 'conditions' },
  { slug: 'confidentialite', titre: 'Confidentialité', version: LEGAL_VERSIONS.privacy, date: null, statut: 'pending', webPage: 'confidentialite' },
  { slug: 'cookies', titre: 'Cookies', version: 'COOKIES-v2', date: null, statut: 'pending', webPage: 'mentions' },
  { slug: 'mentions', titre: 'Mentions légales', version: 'MENTIONS-v2', date: null, statut: 'pending', webPage: 'mentions' },
  { slug: 'declaration-enfant', titre: 'Déclaration relative aux enfants', version: 'DECL-ENFANT-v2', date: null, statut: 'pending', webPage: 'mentions' },
  { slug: 'securite', titre: 'Sécurité', version: 'SECURITE-v2', date: null, statut: 'pending', webPage: 'mentions' },
];

export function getLegalDocument(slug: string | undefined): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((d) => d.slug === slug);
}

/** Contenu à afficher, ou `null` tant que le document est en cours de finalisation. */
export function legalDocumentBody(doc: LegalDocument): string | null {
  return doc.statut === 'ready' && doc.contenu && doc.contenu.trim() ? doc.contenu : null;
}

export type LegalBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] };

/** Texte simple vers blocs : lignes `#` = titres, lignes `- ` consécutives = liste, le reste = paragraphes (séparés par une ligne vide). */
export function parseLegalText(text: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ type: 'paragraph', text: para.join(' ') });
    para = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ type: 'list', items: list });
    list = [];
  };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
    } else if (line.startsWith('#')) {
      flushPara();
      flushList();
      const title = line.replace(/^#+\s*/, '');
      if (title) blocks.push({ type: 'heading', text: title });
    } else if (line.startsWith('- ')) {
      flushPara();
      list.push(line.slice(2).trim());
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

/** Ouvre un texte dans l'application (route `app/legal/[doc].tsx`). */
export const legalDocHref = (slug: LegalDocSlug) => ({ pathname: '/legal/[doc]', params: { doc: slug } }) as never;
