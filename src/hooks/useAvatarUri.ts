import { useEffect, useState } from 'react';
import { signedAvatarUrl } from '@/services/avatar';
import type { User } from '@/types';

/**
 * Adresse de la photo à afficher pour l'utilisateur connecté (MOB-1611-2) :
 * - prestataire : `avatar_url` public (approuvé) ; `undefined` → avatar par défaut (initiales) ;
 * - patient : photo privée `avatar_path`, par URL signée sur `avatars-private`.
 */
export function useAvatarUri(
  user: Pick<User, 'role' | 'avatarUrl' | 'avatarPath'> | null | undefined,
): string | undefined {
  const isProvider = user?.role === 'provider';
  const path = isProvider ? undefined : user?.avatarPath;
  const [signed, setSigned] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSigned(null);
    if (path) {
      void signedAvatarUrl(path).then((url) => {
        if (!cancelled) setSigned(url);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (isProvider) return user?.avatarUrl;
  return signed ?? undefined;
}
