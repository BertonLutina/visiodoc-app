import React from 'react';
import { Text, View } from 'react-native';
import { parseLegalText } from '@/config/legalDocuments';

/** Rendu maison d'un texte juridique simple (titres, paragraphes, listes), sans dépendance. */
export function LegalText({ text }: { text: string }) {
  return (
    <View>
      {parseLegalText(text).map((b, i) => {
        if (b.type === 'heading') {
          return (
            <Text key={i} accessibilityRole="header" className="font-sans-bold text-ink text-base mt-5 mb-2">
              {b.text}
            </Text>
          );
        }
        if (b.type === 'list') {
          return (
            <View key={i} className="mb-3">
              {b.items.map((item, j) => (
                <View key={j} className="flex-row mb-1">
                  <Text className="font-sans text-sm text-ink mr-2">{'•'}</Text>
                  <Text className="flex-1 font-sans text-sm text-ink leading-5">{item}</Text>
                </View>
              ))}
            </View>
          );
        }
        return (
          <Text key={i} className="font-sans text-sm text-ink leading-5 mb-3">
            {b.text}
          </Text>
        );
      })}
    </View>
  );
}
