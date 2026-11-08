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

/* ------------------------------------------------------------------------------------------------
 * Marqueur « étape en cours » `credentialsPending:<userId>` : posé AVANT de rendre la main à l'écran
 * (la session créée par le code est déjà persistée) et effacé à l'envoi réussi, à l'abandon ou à la
 * déconnexion depuis l'étape. À la restauration de session, un marqueur correspondant fait fermer la
 * session : l'utilisateur refait le code puis l'étape. Sans marqueur (compte existant) : restauré.
 * ---------------------------------------------------------------------------------------------- */

const PENDING_PREFIX = 'credentialsPending:';
export const credentialsPendingKey = (userId: string) => `${PENDING_PREFIX}${userId}`;

export async function markCredentialsPending(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(credentialsPendingKey(userId), '1');
  } catch {
    /* ignore */
  }
}

export async function clearCredentialsPending(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.removeItem(credentialsPendingKey(userId));
  } catch {
    /* ignore */
  }
}

export async function hasCredentialsPending(userId: string): Promise<boolean> {
  if (!userId) return false;
  try {
    return typeof (await AsyncStorage.getItem(credentialsPendingKey(userId))) === 'string';
  } catch {
    return false;
  }
}

/** Ids de tous les utilisateurs ayant un marqueur (liste vide si le stockage est illisible). */
export async function pendingCredentialsUserIds(): Promise<string[]> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    return keys.filter((k) => k.startsWith(PENDING_PREFIX)).map((k) => k.slice(PENDING_PREFIX.length));
  } catch {
    return [];
  }
}

/** Faux sans id ; vrai seulement si l'id restauré figure parmi les marqueurs. */
export function shouldDropOnRestore(userId: string | null | undefined, markerIds: readonly string[]): boolean {
  return !!userId && markerIds.includes(userId);
}
