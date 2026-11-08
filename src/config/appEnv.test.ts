import { appEnv, parseAppEnv } from './appEnv';

describe('parseAppEnv', () => {
  it.each(['development', 'uat', 'production'] as const)('%s est reconnu tel quel', (value) => {
    expect(parseAppEnv(value)).toBe(value);
  });

  it.each([undefined, '', ' ', 'dev', 'staging', 'Development', 'UAT', 'production ', 'true', 'null'])(
    'valeur %p : retombe sur production (une variable absente ou inconnue n’active jamais le mode développement)',
    (value) => {
      expect(parseAppEnv(value)).toBe('production');
    },
  );
});

describe('appEnv', () => {
  const previous = process.env.EXPO_PUBLIC_APP_ENV;
  afterEach(() => {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_APP_ENV;
    else process.env.EXPO_PUBLIC_APP_ENV = previous;
  });

  it('lit EXPO_PUBLIC_APP_ENV', () => {
    process.env.EXPO_PUBLIC_APP_ENV = 'uat';
    expect(appEnv()).toBe('uat');
    process.env.EXPO_PUBLIC_APP_ENV = 'development';
    expect(appEnv()).toBe('development');
  });

  it('vaut production quand la variable est absente', () => {
    delete process.env.EXPO_PUBLIC_APP_ENV;
    expect(appEnv()).toBe('production');
  });
});
