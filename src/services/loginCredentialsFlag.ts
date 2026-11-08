import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Drapeau « e-mail + mot de passe déjà envoyés » par utilisateur (`credentialsSubmitted:<userId>`).
 *
 * `set-login-credentials` fixe le mot de passe tout de suite mais n'écrit `auth.users.email` qu'au clic sur
 * le lien de confirmation : tant que l'e-mail est en attente, le compte paraît toujours « sans e-mail ».
 * Ce drapeau évite de reproposer l'étape à chaque connexion par code. Donnée non secrète : AsyncStorage.
 */
export const credentialsSubmittedKey = (userId: string) => `credentialsSubmitted:${userId}`;

/** Enregistre le drapeau ; ne lève jamais (un échec d'écriture ne doit pas bloquer l'entrée dans l'app). */
export async function markCredentialsSubmitted(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(credentialsSubmittedKey(userId), '1');
  } catch {
    /* ignore : au pire l'étape est reproposée */
  }
}

export async function hasSubmittedCredentials(userId: string): Promise<boolean> {
  if (!userId) return false;
  try {
    return typeof (await AsyncStorage.getItem(credentialsSubmittedKey(userId))) === 'string';
  } catch {
    return false;
  }
}
