import { configurationProblem } from './configurationProblem';

const URL = 'https://example.invalid';
const KEY = 'placeholder-not-a-real-key';

describe('configurationProblem', () => {
  it('production sans clé anonyme : message nommant EXPO_PUBLIC_SUPABASE_ANON_KEY (et pas l’URL)', () => {
    const message = configurationProblem({ url: URL, anonKey: undefined, appEnv: 'production' });
    expect(message).toContain('EXPO_PUBLIC_SUPABASE_ANON_KEY');
    expect(message).not.toContain('EXPO_PUBLIC_SUPABASE_URL');
    expect(message).toContain('Configuration manquante');
  });

  it('production complète : null', () => {
    expect(configurationProblem({ url: URL, anonKey: KEY, appEnv: 'production' })).toBeNull();
  });

  it('uat sans URL : message nommant EXPO_PUBLIC_SUPABASE_URL (et pas la clé)', () => {
    const message = configurationProblem({ url: undefined, anonKey: KEY, appEnv: 'uat' });
    expect(message).toContain('EXPO_PUBLIC_SUPABASE_URL');
    expect(message).not.toContain('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  });

  it('uat sans URL ni clé : nomme les deux variables', () => {
    const message = configurationProblem({ appEnv: 'uat' });
    expect(message).toContain('EXPO_PUBLIC_SUPABASE_URL');
    expect(message).toContain('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  });

  it('valeurs vides ou blanches = manquantes', () => {
    expect(configurationProblem({ url: URL, anonKey: '', appEnv: 'production' })).toContain('EXPO_PUBLIC_SUPABASE_ANON_KEY');
    expect(configurationProblem({ url: '   ', anonKey: KEY, appEnv: 'uat' })).toContain('EXPO_PUBLIC_SUPABASE_URL');
  });

  it('development sans rien : null (les données mock restent possibles)', () => {
    expect(configurationProblem({ appEnv: 'development' })).toBeNull();
    expect(configurationProblem({ url: '', anonKey: '', appEnv: 'development' })).toBeNull();
  });

  it('le message ne contient jamais les valeurs fournies', () => {
    const message = configurationProblem({ url: URL, anonKey: undefined, appEnv: 'production' }) ?? '';
    expect(message).not.toContain(URL);
    expect(message).not.toContain(KEY);
  });
});
