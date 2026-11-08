// eas.json est lu tel quel : le test garantit la séparation UAT / Production et l'absence de secret commité.
// `require` (comme les autres tests du dépôt) : les types Node ne sont pas chargés par tsconfig.
const raw: string = require('fs').readFileSync(require('path').resolve(process.cwd(), 'eas.json'), 'utf8');
const eas = JSON.parse(raw) as {
  build: Record<string, { env?: Record<string, string> }>;
};

const UAT_URL = 'https://pslypdfjmjetjhtpzwip.supabase.co';
const PROD_URL = 'https://cftqxuxhsellvquidpxr.supabase.co';
const UAT_REF = 'pslypdfjmjetjhtpzwip';
const PROD_REF = 'cftqxuxhsellvquidpxr';

const env = (profile: string): Record<string, string> => eas.build[profile]?.env ?? {};

describe('eas.json : aucun secret commité', () => {
  it('ne contient aucun jeton JWT (eyJ…)', () => {
    expect(raw).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });

  it('ne mentionne pas service_role', () => {
    expect(raw).not.toContain('service_role');
  });

  it("ne définit aucune clé anonyme : elle vient des secrets EAS par environnement", () => {
    for (const profile of ['development', 'preview', 'production']) {
      expect(Object.keys(env(profile))).not.toContain('EXPO_PUBLIC_SUPABASE_ANON_KEY');
    }
    expect(raw).not.toContain('ANON_KEY');
  });
});

describe('eas.json : séparation UAT / Production', () => {
  it('liste exactement les trois profils de build attendus', () => {
    expect(Object.keys(eas.build).sort()).toEqual(['development', 'preview', 'production']);
  });

  it.each(['development', 'preview', 'production'])(
    '%s : env contient exactement APP_ENV et SUPABASE_URL (aucune autre clé, donc aucun secret glissé)',
    (profile) => {
      expect(Object.keys(env(profile)).sort()).toEqual(['EXPO_PUBLIC_APP_ENV', 'EXPO_PUBLIC_SUPABASE_URL']);
    },
  );

  it('development : APP_ENV development et URL UAT, jamais Production', () => {
    expect(env('development').EXPO_PUBLIC_APP_ENV).toBe('development');
    expect(env('development').EXPO_PUBLIC_SUPABASE_URL).toBe(UAT_URL);
    expect(JSON.stringify(eas.build.development)).not.toContain(PROD_REF);
  });

  it('preview : APP_ENV uat et URL UAT, jamais Production', () => {
    expect(env('preview').EXPO_PUBLIC_APP_ENV).toBe('uat');
    expect(env('preview').EXPO_PUBLIC_SUPABASE_URL).toBe(UAT_URL);
    expect(JSON.stringify(eas.build.preview)).not.toContain(PROD_REF);
  });

  it('production : APP_ENV production et URL Production, jamais UAT', () => {
    expect(env('production').EXPO_PUBLIC_APP_ENV).toBe('production');
    expect(env('production').EXPO_PUBLIC_SUPABASE_URL).toBe(PROD_URL);
    expect(JSON.stringify(eas.build.production)).not.toContain(UAT_REF);
  });

  it.each(['development', 'preview', 'production'])('%s : EXPO_PUBLIC_SUPABASE_URL est en https://', (profile) => {
    expect(env(profile).EXPO_PUBLIC_SUPABASE_URL.startsWith('https://')).toBe(true);
  });

  it('ne fige aucun identifiant marchand de paiement (variables EAS par environnement)', () => {
    for (const profile of ['development', 'preview', 'production']) {
      expect(Object.keys(env(profile)).filter((k) => k.startsWith('EXPO_PUBLIC_ISW_'))).toEqual([]);
    }
  });

  it('ne force EXPO_PUBLIC_SIMULATE_PROVIDER_PAYMENT dans aucun profil', () => {
    for (const profile of ['development', 'preview', 'production']) {
      expect(Object.keys(env(profile))).not.toContain('EXPO_PUBLIC_SIMULATE_PROVIDER_PAYMENT');
    }
  });
});
