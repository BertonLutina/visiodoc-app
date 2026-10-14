import React from 'react';
import { Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';

let mockUser: { preferredLanguage?: string } | null = null;
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));

import { LanguageProvider, useLanguage, useT } from './index';
import { currentLangCode, setCurrentLangCode } from './core';

function Probe() {
  const t = useT();
  const { language, setLanguage } = useLanguage();
  return (
    <Text onPress={() => setLanguage('Lingala')} testID="probe">
      {language}|{t('Se connecter')}
    </Text>
  );
}

const text = (r: renderer.ReactTestRenderer) => String(r.root.findByProps({ testID: 'probe' }).props.children.join(''));

describe('LanguageProvider', () => {
  afterEach(() => {
    mockUser = null;
    setCurrentLangCode('fr');
  });

  it('defaults to French', async () => {
    let r!: renderer.ReactTestRenderer;
    await act(async () => {
      r = renderer.create(
        <LanguageProvider>
          <Probe />
        </LanguageProvider>,
      );
    });
    expect(text(r)).toBe('Français|Se connecter');
  });

  it("follows the signed-in user's preferred language", async () => {
    mockUser = { preferredLanguage: 'English' };
    let r!: renderer.ReactTestRenderer;
    await act(async () => {
      r = renderer.create(
        <LanguageProvider>
          <Probe />
        </LanguageProvider>,
      );
    });
    expect(text(r)).toBe('English|Sign in');
    expect(currentLangCode()).toBe('en');
  });

  it('switches the whole tree immediately when the language is changed', async () => {
    mockUser = { preferredLanguage: 'English' };
    let r!: renderer.ReactTestRenderer;
    await act(async () => {
      r = renderer.create(
        <LanguageProvider>
          <Probe />
        </LanguageProvider>,
      );
    });
    await act(async () => {
      r.root.findByProps({ testID: 'probe' }).props.onPress();
    });
    expect(text(r)).toBe('Lingala|Kokota');
  });
});
