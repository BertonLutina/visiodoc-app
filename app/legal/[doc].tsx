import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { useT } from '@/i18n';
import { getLegalDocument, legalDocumentBody } from '@/config/legalDocuments';
import { legalUrl } from '@/services/legal';
import { LegalText } from '@/components/LegalText';

/** Lecture d'un texte juridique dans l'application ; en cours de finalisation, renvoie vers le site. */
export default function LegalDocScreen() {
  const t = useT();
  const { doc } = useLocalSearchParams<{ doc?: string }>();
  const document = getLegalDocument(doc);
  const body = document ? legalDocumentBody(document) : null;
  const webUrl = legalUrl(document?.webPage ?? 'mentions');

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2" accessibilityRole="button" accessibilityLabel={t('Retour')}>
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="flex-1 font-sans-bold text-lg text-ink" numberOfLines={1}>
          {document ? t(document.titre) : t('Informations légales')}
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
        {document ? (
          <Text className="font-sans text-xs text-muted mb-4">
            {document.date ? `${document.version} · ${document.date}` : document.version}
          </Text>
        ) : null}
        {body ? (
          <LegalText text={body} />
        ) : (
          <Text className="font-sans text-base text-ink leading-6 mb-6">
            {t('Document en cours de finalisation. La version en vigueur reste consultable sur le site.')}
          </Text>
        )}
        {!body ? (
          <Pressable
            onPress={() => WebBrowser.openBrowserAsync(webUrl)}
            accessibilityRole="button"
            className="bg-primary rounded-2xl py-4 items-center"
          >
            <Text className="font-sans-semibold text-white">{t('Consulter la version du site')}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
