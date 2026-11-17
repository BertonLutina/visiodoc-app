import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { startConsultationBestEffort } from '@/services/providerApi';
import { serverNowMs } from '@/utils/serverClock';
import { providerStartWindow, startDeniedMessage, type StartWindowState } from '@/utils/startWindow';

/** État de la fenêtre de démarrage, recalculé chaque seconde tant qu'elle est à venir ou ouverte (horloge serveur estimée). */
export function useStartWindow(scheduledAt: string | undefined, rawStatus: string | undefined): StartWindowState {
  const [, setTick] = useState(0);
  const state = providerStartWindow(scheduledAt, rawStatus, serverNowMs());
  const ticking = state.phase === 'before' || state.phase === 'open';
  useEffect(() => {
    if (!ticking) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [ticking]);
  return state;
}

type Startable = { id: string; roomId?: string; scheduledAt?: string; rawStatus?: string };

/**
 * « Démarrer » côté médecin. Un appel déjà `in_progress` se rejoint sans écriture. Sinon la base n'accepte
 * `in_progress` que dans la fenêtre ([MOB-1611-1]) : un refus 42501 affiche le message du guide et n'ouvre pas
 * l'appel ; une panne réseau n'empêche pas d'entrer (`get-video-token` fait foi et refuse hors fenêtre).
 */
export async function launchProviderCall(c: Startable): Promise<void> {
  if (c.rawStatus !== 'in_progress') {
    const outcome = await startConsultationBestEffort(c.id);
    if (outcome === 'denied') {
      Alert.alert(startDeniedMessage());
      return;
    }
  }
  router.push(`/call/${c.roomId ?? c.id}`);
}
