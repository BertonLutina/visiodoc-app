import { HEALTH_CONSENT_DEFAULT, LEGAL_VERSIONS } from '@/config/legalVersions';
import { LEGAL_DOCUMENTS, getLegalDocument, legalDocumentBody, parseLegalText } from '@/config/legalDocuments';

describe('HEALTH_CONSENT_DEFAULT', () => {
  it('est cochée par défaut (décision produit du 19/11/2026)', () => {
    expect(HEALTH_CONSENT_DEFAULT).toBe(true);
  });
});

describe('registre des textes juridiques', () => {
  it('contient les sept documents attendus, slugs uniques', () => {
    const slugs = LEGAL_DOCUMENTS.map((d) => d.slug);
    expect(slugs.sort()).toEqual(
      ['cgu-patient', 'cgu-pro', 'confidentialite', 'cookies', 'declaration-enfant', 'mentions', 'securite'].sort(),
    );
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('tous en attente aujourd\'hui, sans contenu', () => {
    for (const d of LEGAL_DOCUMENTS) {
      expect(d.statut).toBe('pending');
      expect(legalDocumentBody(d)).toBeNull();
    }
  });

  it('reprend les versions envoyées au serveur', () => {
    expect(getLegalDocument('cgu-patient')?.version).toBe(LEGAL_VERSIONS.cguPatient);
    expect(getLegalDocument('cgu-pro')?.version).toBe(LEGAL_VERSIONS.cguPro);
    expect(getLegalDocument('confidentialite')?.version).toBe(LEGAL_VERSIONS.privacy);
  });

  it('slug inconnu : undefined', () => {
    expect(getLegalDocument('nimporte-quoi')).toBeUndefined();
    expect(getLegalDocument(undefined)).toBeUndefined();
  });

  it('un document prêt expose son contenu', () => {
    const base = LEGAL_DOCUMENTS[0];
    expect(legalDocumentBody({ ...base, statut: 'ready', contenu: '# T\n\nTexte' })).toBe('# T\n\nTexte');
    expect(legalDocumentBody({ ...base, statut: 'ready', contenu: '   ' })).toBeNull();
    expect(legalDocumentBody({ ...base, statut: 'pending', contenu: 'Texte' })).toBeNull();
  });
});

describe('parseLegalText', () => {
  it('titres, paragraphes et listes', () => {
    const text = '# Titre\n\nPremière ligne\nsuite du paragraphe.\n\nSecond paragraphe.\n\n- un\n- deux\n\n## Sous-titre\nAprès.';
    expect(parseLegalText(text)).toEqual([
      { type: 'heading', text: 'Titre' },
      { type: 'paragraph', text: 'Première ligne suite du paragraphe.' },
      { type: 'paragraph', text: 'Second paragraphe.' },
      { type: 'list', items: ['un', 'deux'] },
      { type: 'heading', text: 'Sous-titre' },
      { type: 'paragraph', text: 'Après.' },
    ]);
  });

  it('tolère CRLF, lignes vides multiples et texte vide', () => {
    expect(parseLegalText('A\r\n\r\n\r\nB')).toEqual([
      { type: 'paragraph', text: 'A' },
      { type: 'paragraph', text: 'B' },
    ]);
    expect(parseLegalText('')).toEqual([]);
  });

  it('une liste collée à un paragraphe les sépare', () => {
    expect(parseLegalText('Intro\n- a\n- b\nFin')).toEqual([
      { type: 'paragraph', text: 'Intro' },
      { type: 'list', items: ['a', 'b'] },
      { type: 'paragraph', text: 'Fin' },
    ]);
  });
});
