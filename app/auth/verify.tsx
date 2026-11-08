import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MailCheck, XCircle } from 'lucide-react-native';
import { Button, ScreenTitle } from '@/components/ui';
import { colors } from '@/theme/colors';
import { MagicLinkError, magicLinkErrorMessage, parseMagicLinkToken } from '@/services/magicLink';
import { providerHomeHref } from '@/services/accessPolicy';
import { useAuth } from '@/contexts/AuthContext';
import { useT } from '@/i18n';
import type { User } from '@/types';

/**
 * Cible du lien reçu par e-mail : `https://app.visiodoc.online/auth/verify?token=<64 hex>` (lien
 * universel / App Link) ou `visiodoc://auth/verify?token=…`. Le jeton est à usage unique : une seule
 * requête part par jeton, même si l'écran est monté deux fois (le second montage attend la même).
 */
const attempts = new Map<string, Promise<User>>();

export default function VerifyMagicLink() {
  const t = useT();
  const { verifyMagicLink, initializing } = useAuth();
  const { token } = useLocalSearchParams<{ token?: string | string[] }>();
  const [error, setError] = useState<string | null>(null);

  const parsed = parseMagicLinkToken(token);

  useEffect(() => {
    // Démarrage à froid par le lien : on attend la fin de la restauration de session, sinon elle pourrait
    // réécrire l'utilisateur d'une ancienne session par-dessus celui du lien.
    if (initializing) return;
    if (!parsed) {
      setError(magicLinkErrorMessage(new MagicLinkError('invalid_link', 'invalid token')));
      return;
    }
    let active = true;
    setError(null);
    let attempt = attempts.get(parsed);
    if (!attempt) {
      attempt = verifyMagicLink(parsed);
      attempts.set(parsed, attempt);
      // Un échec (réseau…) laisse la possibilité de rouvrir le lien ; un jeton déjà utilisé est refusé par le serveur.
      attempt.catch(() => attempts.delete(parsed));
    }
    attempt.then(
      (u) => {
        if (active) router.replace(u ? providerHomeHref(u) : '/(patient)');
      },
      (e) => {
        if (active) setError(magicLinkErrorMessage(e));
      },
    );
    return () => {
      active = false;
    };
  }, [parsed, initializing]);

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <View className="flex-1 items-center justify-center px-6">
        {error ? (
          <>
            <View className="w-14 h-14 rounded-3xl items-center justify-center mb-4 bg-red-50">
              <XCircle color={colors.danger} size={28} />
            </View>
            <ScreenTitle center>{t('Erreur de connexion')}</ScreenTitle>
            <Text className="font-sans text-base text-muted mt-2 mb-6 text-center">{error}</Text>
            <View className="self-stretch">
              <Button label={t('Demander un nouveau lien')} onPress={() => router.replace('/(auth)/magic-link')} />
              <Button
                label={t('Retour à la connexion')}
                variant="outline"
                onPress={() => router.replace('/(auth)/login')}
              />
            </View>
          </>
        ) : (
          <>
            <View className="w-14 h-14 rounded-3xl items-center justify-center mb-4 bg-primary-50">
              <MailCheck color={colors.primary} size={28} />
            </View>
            <ScreenTitle center>{t('Vérification en cours…')}</ScreenTitle>
            <Text className="font-sans text-base text-muted mt-2 mb-6 text-center">
              {t('Un instant, nous vérifions votre lien de connexion.')}
            </Text>
            <ActivityIndicator color={colors.primary} />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
