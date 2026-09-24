import { useEffect } from 'react';
import { Alert } from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import * as biometrics from '@/services/biometrics';

/**
 * Après une connexion active, propose une seule fois par compte
 * d'activer le déverrouillage biométrique.
 */
export function useBiometricOffer() {
  const { user, justSignedIn, consumeJustSignedIn, biometricAvailable, biometricLabel, setBiometricEnabled } =
    useAuth();

  useEffect(() => {
    if (!justSignedIn || !user) return;
    consumeJustSignedIn();
    if (!biometricAvailable) return;

    const userId = user.id;
    (async () => {
      if (await biometrics.wasOffered(userId)) return;
      await biometrics.markOffered(userId);
      Alert.alert(
        'Déverrouillage rapide',
        `Utiliser ${biometricLabel} pour ouvrir VisioDoc la prochaine fois ?`,
        [
          { text: 'Plus tard', style: 'cancel' },
          { text: 'Activer', onPress: () => void setBiometricEnabled(true) },
        ],
      );
    })();
    // Déclenché uniquement par une nouvelle connexion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justSignedIn, user?.id]);
}
