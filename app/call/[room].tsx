import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { ChevronLeft, PhoneOff } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/contexts/AuthContext';
import { getCallSession } from '@/services/patientApi';
import {
  endConsultation,
  getPatientJoinedAt,
  getProviderCallContext,
  markPatientAbsent,
  notifyConsultationStarted,
  logVideoSessionEnd,
  logVideoSessionStart,
} from '@/services/consultationReport';
import { requestCallPermissions } from '@/services/callPermissions';
import {
  buildRoomWebViewUrl,
  fetchVideoToken,
  isAllowedRoomNavigation,
  type VideoFailure,
  type VideoUnavailable,
} from '@/services/videoToken';
import { CallOutcomeModal } from '@/components/CallOutcomeModal';
import { useT } from '@/i18n';

/** Au-delà de ce délai, la relance automatique à l'ouverture de la salle n'est pas programmée (le bouton reste). */
const MAX_AUTO_RETRY_MS = 6 * 60 * 60 * 1000;

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; url: string; serverUrl: string; roomName: string }
  | { kind: 'failed'; failure: VideoFailure | VideoUnavailable }
  | { kind: 'permission'; blocked: boolean }
  | { kind: 'interrupted' };

/**
 * Écran d'appel (patient ET médecin : même route, même contrat, c'est le serveur qui décide du rôle).
 * `room` = `video_room_id` sinon `id` de la consultation (voir les listes) ; `get-video-token` ne reçoit que `{ roomId }`.
 * Succès : la salle `${serverUrl}/${roomName}?jwt=${jwt}` s'ouvre dans une WebView (caméra + micro). Le jeton n'est
 * ni affiché, ni journalisé. La fenêtre horaire est appliquée par le serveur : on relaie ses refus 403.
 */
export default function VideoCall() {
  const t = useT();
  const { room } = useLocalSearchParams<{ room: string }>();
  const routeRoomId = typeof room === 'string' ? room : '';
  const { data: session, loading: sessionLoading } = useAsync(() => getCallSession(routeRoomId), [routeRoomId]);
  const { user } = useAuth();
  // Côté prestataire seulement : la consultation de cette salle dont l'utilisateur est le prestataire (sinon null).
  const providerId = user?.id ?? '';
  const { data: providerCtx } = useAsync(() => getProviderCallContext(routeRoomId, providerId), [routeRoomId, providerId]);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // `roomId` du contrat : celui de la consultation lue en base (video_room_id sinon id), sinon le paramètre de route.
  const roomId = session?.roomId ?? routeRoomId;

  useEffect(() => {
    if (sessionLoading) return;
    let active = true;
    setPhase({ kind: 'loading' });
    (async () => {
      if (!roomId) {
        if (active) {
          setPhase({
            kind: 'failed',
            failure: {
              kind: 'unavailable',
              message: t('Impossible de joindre la salle. Vérifie ta connexion et réessaie.'),
              opensAt: null,
            },
          });
        }
        return;
      }
      const result = await fetchVideoToken(roomId);
      if (!active) return;
      if (!result.ok) {
        setPhase({ kind: 'failed', failure: result.failure });
        return;
      }
      const permission = await requestCallPermissions();
      if (!active) return;
      if (permission !== 'granted') {
        setPhase({ kind: 'permission', blocked: permission === 'blocked' });
        return;
      }
      setPhase({
        kind: 'ready',
        url: buildRoomWebViewUrl(result.session),
        serverUrl: result.session.serverUrl,
        roomName: result.session.roomName,
      });
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionLoading, roomId, attempt]);

  // Trop tôt : on rejoue la demande à l'heure d'ouverture indiquée par le serveur (le serveur reste juge).
  const opensAt = phase.kind === 'failed' && phase.failure.kind === 'too_early' ? phase.failure.opensAt : null;
  useEffect(() => {
    if (!opensAt) return;
    const delay = new Date(opensAt).getTime() - Date.now();
    if (!(delay > 0) || delay > MAX_AUTO_RETRY_MS) return;
    const timer = setTimeout(retry, delay + 1000);
    return () => clearTimeout(timer);
  }, [opensAt, retry]);

  // Trace de l'appel (table video_sessions, comme le web) et notification du patient, prestataire seulement,
  // best effort, une seule fois par ouverture de la salle.
  const videoSessionId = useRef<Promise<string | null> | null>(null);
  const callStartedAt = useRef<number | null>(null);
  const readyRoomName = phase.kind === 'ready' ? phase.roomName : null;
  useEffect(() => {
    if (!providerCtx || !readyRoomName || !providerId || videoSessionId.current) return;
    callStartedAt.current = Date.now();
    videoSessionId.current = logVideoSessionStart({
      consultationId: providerCtx.consultationId,
      roomName: readyRoomName,
      initiatedBy: providerId,
    });
    notifyConsultationStarted(providerCtx.consultationId);
  }, [providerCtx, readyRoomName, providerId]);

  /** Clôt la trace vidéo (une fois) au moment où le prestataire quitte vraiment l'appel. */
  const endTrace = () => {
    const pending = videoSessionId.current;
    const startedAt = callStartedAt.current;
    videoSessionId.current = null;
    if (pending && startedAt) {
      pending.then((sid) => (sid ? logVideoSessionEnd(sid, (Date.now() - startedAt) / 1000) : undefined)).catch(() => {});
    }
  };

  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  /** Ferme l'appel PUIS ouvre le rapport (l'écran d'appel est remplacé par le rapport). */
  const leaveToReport = (consultationId: string) => {
    endTrace();
    router.replace(`/provider/consultation-report/${consultationId}`);
  };

  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [patientJoinedAt, setPatientJoinedAt] = useState<string | null>(null);
  // Relu à chaque ouverture de la boîte de fin d'appel (best effort : null tant que la colonne n'existe pas).
  const providerConsultationId = providerCtx?.consultationId ?? null;
  useEffect(() => {
    if (!outcomeOpen || !providerConsultationId) return;
    let cancelled = false;
    getPatientJoinedAt(providerConsultationId).then((v) => {
      if (!cancelled) setPatientJoinedAt(v);
    });
    return () => {
      cancelled = true;
    };
  }, [outcomeOpen, providerConsultationId]);

  const endAndReport = async (consultationId: string) => {
    setOutcomeOpen(false);
    try {
      await endConsultation(consultationId, providerId);
    } catch (e) {
      // Refus (ex. appel jamais démarré) : message clair, le rapport reste accessible.
      Alert.alert(t('Consultation non terminée'), (e as Error)?.message ?? '');
    }
    leaveToReport(consultationId);
  };

  const absentAndLeave = async (consultationId: string) => {
    try {
      await markPatientAbsent(consultationId, providerId);
    } catch (e) {
      // Filet de sécurité (le bouton est normalement grisé) : l'appel reste ouvert, le choix est reproposé.
      const kind = (e as { kind?: string })?.kind;
      const msg =
        kind === 'no_show_too_early' ? (e as Error).message : t('Impossible de déclarer le patient absent. Réessaie.');
      setOutcomeOpen(false);
      Alert.alert(t('Patient absent'), msg, [{ text: 'OK', onPress: () => setOutcomeOpen(true) }], { cancelable: false });
      return;
    }
    // Patient absent : on ferme l'appel sans rapport.
    setOutcomeOpen(false);
    endTrace();
    leave();
  };

  const close = () => {
    if (!providerCtx || phase.kind !== 'ready') {
      leave();
      return;
    }
    setOutcomeOpen(true);
  };

  const canRetry =
    phase.kind === 'permission' ||
    phase.kind === 'interrupted' ||
    (phase.kind === 'failed' && (phase.failure.kind === 'too_early' || phase.failure.kind === 'unavailable'));

  let message: string | null = null;
  if (phase.kind === 'failed') message = phase.failure.message;
  else if (phase.kind === 'permission') {
    message = t('Autorise la caméra et le micro pour rejoindre la téléconsultation.');
  } else if (phase.kind === 'interrupted') message = t('La visioconférence a été interrompue. Réessaie.');

  return (
    <View className="flex-1 bg-ink">
      {providerCtx ? (
        <CallOutcomeModal
          visible={outcomeOpen}
          scheduledAt={providerCtx.scheduledAt}
          startedAt={providerCtx.startedAt}
          patientJoinedAt={patientJoinedAt}
          onEnd={() => endAndReport(providerCtx.consultationId)}
          onAbsent={() => absentAndLeave(providerCtx.consultationId)}
          onLater={() => {
            setOutcomeOpen(false);
            leaveToReport(providerCtx.consultationId);
          }}
        />
      ) : null}
      <SafeAreaView className="flex-1" edges={['top', 'bottom']}>
        {/* En-tête */}
        <View className="flex-row items-center justify-between px-5 pt-2 pb-2">
          <View className="flex-row items-center flex-1">
            <Pressable onPress={close} className="p-1 mr-1" accessibilityRole="button" accessibilityLabel={t('Quitter')}>
              <ChevronLeft color={colors.white} size={26} />
            </Pressable>
            <Text className="text-white font-sans-bold flex-1" numberOfLines={1}>
              {session?.doctorName ?? t('Consultation')}
            </Text>
          </View>
          {phase.kind === 'ready' ? (
            <Pressable
              onPress={close}
              className="w-11 h-11 rounded-full bg-red-500 items-center justify-center"
              accessibilityRole="button"
              accessibilityLabel={t('Quitter')}
            >
              <PhoneOff color={colors.white} size={20} />
            </Pressable>
          ) : null}
        </View>

        {/* Zone vidéo */}
        <View className="flex-1">
          {phase.kind === 'ready' ? (
            <WebView
              source={{ uri: phase.url }}
              // La salle (jeton dans l'URL) ne navigue que sur l'hôte du serveur vidéo reçu de `get-video-token` ou sur 8x8.vc.
              originWhitelist={['https://*']}
              onShouldStartLoadWithRequest={(req) => {
                const topFrame = req.isTopFrame !== false;
                const allowed = isAllowedRoomNavigation(req.url, phase.serverUrl, topFrame);
                // Navigation de page bloquée : sans retour d'état, l'écran resterait vide. On affiche l'erreur
                // (avec « Réessayer ») sans journaliser l'URL (elle contient le jeton).
                if (!allowed && topFrame) setPhase({ kind: 'failed', failure: unavailableFailure(t) });
                return allowed;
              }}
              javaScriptEnabled
              domStorageEnabled
              setSupportMultipleWindows={false}
              // Caméra / micro : lecture sans geste (Android + iOS), vidéo en ligne (iOS), accord de capture pour
              // l'hôte de la salle (iOS 15+) ; permissions Android demandées avant l'ouverture.
              mediaPlaybackRequiresUserAction={false}
              allowsInlineMediaPlayback
              mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
              // Aucun détail d'erreur affiché ni journalisé : l'URL de l'événement contient le jeton.
              onError={() => setPhase({ kind: 'failed', failure: unavailableFailure(t) })}
              onHttpError={() => setPhase({ kind: 'failed', failure: unavailableFailure(t) })}
              onRenderProcessGone={() => setPhase({ kind: 'interrupted' })}
              onContentProcessDidTerminate={() => setPhase({ kind: 'interrupted' })}
              style={{ flex: 1, backgroundColor: colors.ink }}
            />
          ) : phase.kind === 'loading' ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator color={colors.white} />
              <Text className="text-white/70 font-sans mt-4">{t('Connexion à la salle…')}</Text>
            </View>
          ) : (
            <View className="flex-1 items-center justify-center px-8">
              <Text className="text-white font-sans text-center text-base">{message}</Text>
              {phase.kind === 'permission' && phase.blocked ? (
                <Pressable
                  onPress={() => Linking.openSettings()}
                  className="mt-6 rounded-full bg-white/15 px-6 py-3"
                  accessibilityRole="button"
                >
                  <Text className="text-white font-sans-bold">{t('Ouvrir les réglages')}</Text>
                </Pressable>
              ) : null}
              {canRetry ? (
                <Pressable
                  onPress={retry}
                  className="mt-4 rounded-full bg-primary px-6 py-3"
                  accessibilityRole="button"
                >
                  <Text className="text-white font-sans-bold">{t('Réessayer')}</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={close} className="mt-4 px-6 py-3" accessibilityRole="button">
                <Text className="text-white/70 font-sans">{t('Quitter')}</Text>
              </Pressable>
            </View>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const unavailableFailure = (t: (text: string) => string): VideoUnavailable => ({
  kind: 'unavailable',
  message: t('Impossible de joindre la salle. Vérifie ta connexion et réessaie.'),
  opensAt: null,
});
