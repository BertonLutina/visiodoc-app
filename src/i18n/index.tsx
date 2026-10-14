import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/contexts/AuthContext';
import {
  LANGUAGE_STORAGE_KEY,
  interpolate,
  langCodeFor,
  localeFor,
  setCurrentLangCode,
  translate,
  type LangCode,
  type Vars,
} from './core';

export * from './core';

type LanguageContextValue = {
  /** Libellé choisi, ex: 'Lingala'. */
  language: string;
  code: LangCode;
  locale: string;
  setLanguage: (label: string) => void;
  t: (text: string, vars?: Vars) => string;
};

const LanguageContext = createContext<LanguageContextValue>({
  language: 'Français',
  code: 'fr',
  locale: 'fr-FR',
  setLanguage: () => {},
  t: (text, vars) => interpolate(text, vars),
});

/** À placer sous AuthProvider : suit `user.preferredLanguage`, mémorise le choix sur l'appareil. */
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [language, setLanguageState] = useState('Français');

  // Langue mémorisée sur l'appareil (écrans de connexion, avant de connaître le compte).
  useEffect(() => {
    AsyncStorage.getItem(LANGUAGE_STORAGE_KEY)
      .then((v) => v && setLanguageState(v))
      .catch(() => {});
  }, []);

  // Langue du compte : prioritaire dès qu'on connaît l'utilisateur.
  const accountLanguage = user?.preferredLanguage;
  useEffect(() => {
    if (accountLanguage) {
      setLanguageState(accountLanguage);
      AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, accountLanguage).catch(() => {});
    }
  }, [accountLanguage]);

  const code = langCodeFor(language);
  setCurrentLangCode(code); // synchrone : les `translate()` des enfants voient déjà la bonne langue

  const setLanguage = useCallback((label: string) => {
    setLanguageState(label);
    AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, label).catch(() => {});
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      code,
      locale: localeFor(code),
      setLanguage,
      t: (text, vars) => translate(text, vars, code),
    }),
    [language, code, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}

/** `const t = useT();` puis `t('Texte français')`. Re-rend le composant au changement de langue. */
export function useT() {
  return useContext(LanguageContext).t;
}
