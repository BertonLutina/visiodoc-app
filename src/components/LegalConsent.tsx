import React from 'react';
import { Pressable, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Check } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { useT } from '@/i18n';
import { legalUrl, splitTemplate } from '@/services/legal';

/**
 * Phrase sous « Créer mon compte » : appuyer sur le bouton vaut acceptation, aucune case (décision de Chris).
 * Les deux noms sont des liens vers les pages du site (mécanisme de `LegalAccountSection`).
 */
export function LegalNotice({ className = '' }: { className?: string }) {
  const t = useT();
  const links: Record<string, { label: string; url: string }> = {
    cgu: { label: t('CGU'), url: legalUrl('conditions') },
    privacy: { label: t('politique de confidentialité'), url: legalUrl('confidentialite') },
  };
  const parts = splitTemplate(t("En créant mon compte, j'accepte les {cgu} et j'ai lu la {privacy}."), ['cgu', 'privacy']);
  return (
    <Text className={`font-sans text-xs text-muted text-center leading-5 ${className}`}>
      {parts.map((p, i) =>
        p.type === 'text' ? (
          <Text key={i}>{p.text}</Text>
        ) : (
          <Text
            key={i}
            accessibilityRole="link"
            className="font-sans-semibold text-primary underline"
            onPress={() => WebBrowser.openBrowserAsync(links[p.name].url)}
          >
            {links[p.name].label}
          </Text>
        ),
      )}
    </Text>
  );
}

/** Case unique du consentement au traitement des données de santé (patient), décochée par défaut. */
export function HealthConsentCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const t = useT();
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      className="flex-row items-start mb-3 mt-1"
    >
      <View
        className={`w-6 h-6 rounded-md border items-center justify-center mr-3 ${checked ? 'bg-primary border-primary' : 'bg-surface border-line'}`}
      >
        {checked ? <Check color={colors.white} size={16} /> : null}
      </View>
      <Text className="flex-1 font-sans text-sm text-ink leading-5">
        {t("J'accepte que Visiodoc traite mes données de santé pour mes consultations.")}
      </Text>
    </Pressable>
  );
}
