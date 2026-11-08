import { Alert } from 'react-native';
import { currentUserId, resolveDismissedAttempt } from '@/services/paymentAttempt';

type T = (key: string) => string;

/**
 * Issue `dismissed` du widget : jamais « paiement non effectué ». Écran quitté (`user_left`) → « Tu as été
 * débité ? » : Oui = on garde la tentative et on affiche le message de vérification ; Non = tentative effacée.
 * Retour passerelle sans résultat / timeout → message de vérification directement (tentative conservée).
 */
export async function showDismissedPaymentPrompt(
  consultationId: string,
  reason: 'user_left' | 'gateway_returned' | 'timeout',
  t: T,
): Promise<void> {
  // Sans session (expiration pendant le paiement) : pas d'invite — « Non » ne pourrait rien effacer et l'app
  // redirige vers la connexion ; la tentative est conservée et rattrapée à la reconnexion.
  if (!(await currentUserId())) return;
  const verifying = () =>
    Alert.alert(
      t('Paiement en cours de confirmation'),
      t('Paiement en cours de vérification, ne repaie pas. Réessaie dans quelques minutes.'),
    );
  if (reason !== 'user_left') {
    verifying();
    return;
  }
  Alert.alert(
    t('Tu as été débité ?'),
    t('Tu as quitté le paiement avant la fin. Nous ne savons pas si le paiement a abouti.'),
    [
      { text: t('Oui'), onPress: () => verifying() },
      { text: t('Non'), style: 'cancel', onPress: () => void resolveDismissedAttempt(consultationId, false) },
    ],
  );
}
