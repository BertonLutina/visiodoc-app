import { supabase } from '@/lib/supabase';
import { translate } from '@/i18n/core';
import { readHttpError } from '@/utils/authError';
import { reportSessionExpiry } from './sessionExpiry';

/* ------------------------------------------------------------------------------------------------
 * Visio : contrat `get-video-token` (guide, étape 6 et [MOB-0612-3]).
 *   POST /functions/v1/get-video-token  { roomId }   Authorization: Bearer <session>  (functions.invoke)
 *   200 { success: true, data: { provider, mode, serverUrl, roomName, jwt } }
 *   403 { success: false, code: 'room_not_open_yet' | 'room_closed' | 'consultation_cancelled', opensAt, error }
 *   403 { success: false, error: 'Accès à cette salle refusé' }     401 { success: false, error: 'Non authentifié' }
 * L'identité (nom, e-mail pseudonyme, rôle modérateur / participant) est construite PAR LE SERVEUR : le corps ne
 * contient QUE `roomId`. La fenêtre (ouverture 15 min avant, fermeture 30 min après la fin) est appliquée côté
 * serveur : le client n'en déduit aucun refus, il relaie les codes 403.
 * ---------------------------------------------------------------------------------------------- */

/** `roomId` du contrat : `consultations.video_room_id` si renseigné, sinon `consultations.id`. */
export function videoRoomId(consultation: { id: string; video_room_id?: string | null }): string {
  return consultation.video_room_id ? consultation.video_room_id : consultation.id;
}

/** Corps de la requête : EXACTEMENT `{ roomId }` (jamais userName / userEmail / userPhone / userId / role). */
export function videoJoinBody(roomId: string): { roomId: string } {
  return { roomId };
}

export type VideoFailureKind = 'too_early' | 'closed' | 'cancelled' | 'denied' | 'unauthenticated';

export type VideoFailure = {
  kind: VideoFailureKind;
  message: string;
  /** Instant d'ouverture de la salle (ISO), seulement pour `too_early` avec un `opensAt` valide. */
  opensAt: string | null;
};

/** Heure locale de l'appareil, `HH:MM` sur 24 h (zéro-complétée) ; `null` si la date est absente ou invalide. */
function localHhMm(iso: string | null | undefined): string | null {
  if (typeof iso !== 'string' || !iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Refus du serveur (401 / 403) → type, message affichable et instant d'ouverture éventuel. */
export function videoFailure(
  status: number,
  body: { code?: string; opensAt?: string | null; error?: string },
): VideoFailure {
  if (status === 401) {
    return { kind: 'unauthenticated', message: translate('Ta session a expiré, reconnecte-toi.'), opensAt: null };
  }
  switch (body?.code) {
    case 'room_not_open_yet': {
      const time = localHhMm(body.opensAt);
      if (!time) {
        return { kind: 'too_early', message: translate("La consultation n'est pas encore ouverte"), opensAt: null };
      }
      return {
        kind: 'too_early',
        message: translate("La consultation n'est pas encore ouverte (la salle ouvre à {time})", { time }),
        opensAt: body.opensAt as string,
      };
    }
    case 'room_closed':
      return { kind: 'closed', message: translate('La salle de cette consultation est fermée'), opensAt: null };
    case 'consultation_cancelled':
      return { kind: 'cancelled', message: translate('Cette consultation est annulée ou manquée'), opensAt: null };
    default:
      return { kind: 'denied', message: translate('Accès à cette salle refusé'), opensAt: null };
  }
}

/** Champs utilisés de la réponse 200 (guide : `data.serverUrl`, `data.roomName`, `data.jwt`). */
export type VideoSession = { serverUrl: string; roomName: string; jwt: string };

/** Vrai pour une URL `https://…` : le client n'ouvre jamais une salle en clair. */
export function isHttpsServerUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && /^https:\/\/[^/\s]/i.test(url);
}

/**
 * URL de la salle pour la WebView : `${serverUrl}/${roomName}?jwt=${jwt}` (guide, solution de repli).
 * - Les `/` finaux de `serverUrl` et initiaux de `roomName` sont retirés (pas de double `/`) ; le `/` interne de
 *   `roomName` (`<AppID>/TeleMedecine_<roomId>`) est conservé tel quel.
 * - Le JWT n'est encodé que par `encodeURIComponent` : un JWT (base64url + `.`) ne contient que des caractères
 *   sûrs, donc l'URL est inchangée ; l'encodage ne protège que d'une valeur inattendue.
 * - Aucun paramètre d'enregistrement : `recording` n'est pas activé par l'URL.
 */
export function buildRoomUrl({ serverUrl, roomName, jwt }: VideoSession): string {
  const base = serverUrl.replace(/\/+$/, '');
  const room = roomName.replace(/^\/+/, '');
  return `${base}/${room}?jwt=${encodeURIComponent(jwt)}`;
}

/**
 * URL chargée par la WebView : l'URL du contrat + un fragment `#config.disableDeepLinking=true` (réglage CLIENT de
 * Jitsi, jamais envoyé au serveur) pour ne pas afficher la page « ouvrir dans l'application » des navigateurs mobiles.
 * Non vérifié sur appareil.
 */
export function buildRoomWebViewUrl(session: VideoSession): string {
  return `${buildRoomUrl(session)}#config.disableDeepLinking=true`;
}

const httpsHost = (url: string): string | null => {
  const m = /^https:\/\/([^/?#:@\s]+)(?::\d+)?(?:[/?#]|$)/i.exec(url);
  return m ? m[1].toLowerCase() : null;
};

/**
 * Navigations autorisées dans la WebView de la visio : la page principale reste sur l'hôte du serveur vidéo
 * (`about:blank` toléré) ; les cadres intégrés peuvent charger n'importe quel https ; jamais d'http ni d'autre schéma.
 */
export function isAllowedRoomNavigation(url: string, serverUrl: string, isTopFrame: boolean): boolean {
  if (url === 'about:blank') return true;
  const host = httpsHost(url);
  if (!host) return false;
  return isTopFrame ? host === httpsHost(serverUrl) : true;
}

/** Échec réessayable (réseau, 5xx, réponse inattendue) : ce n'est pas un refus du serveur. */
export type VideoUnavailable = { kind: 'unavailable'; message: string; opensAt: null };

export type VideoTokenResult =
  | { ok: true; session: VideoSession }
  | { ok: false; failure: VideoFailure | VideoUnavailable };

const unavailable = (): VideoTokenResult => ({
  ok: false,
  failure: {
    kind: 'unavailable',
    message: translate('Impossible de joindre la salle. Vérifie ta connexion et réessaie.'),
    opensAt: null,
  },
});

const asVideoSession = (body: any): VideoSession | null => {
  const payload = body?.data ?? body;
  const { serverUrl, roomName, jwt } = payload ?? {};
  if (typeof roomName !== 'string' || !roomName || typeof jwt !== 'string' || !jwt) return null;
  if (!isHttpsServerUrl(serverUrl)) return null;
  return { serverUrl, roomName, jwt };
};

/** Rafraîchit la session une fois ; un échec = session expirée (signalée à l'app, qui purge la session). */
async function refreshSessionOnce(): Promise<boolean> {
  try {
    const { error } = await supabase!.auth.refreshSession();
    if (!error) return true;
    reportSessionExpiry(error) || reportSessionExpiry({ code: 'session_expired' });
  } catch {
    reportSessionExpiry({ code: 'session_expired' });
  }
  return false;
}

/**
 * Demande le jeton de salle (`get-video-token`) pour `roomId` avec la session de l'utilisateur
 * (`functions.invoke` envoie `Authorization: Bearer <session>` + `apikey`). Le jeton n'est ni journalisé ni
 * conservé. 401 : rafraîchit la session une fois et rejoue une fois ; sinon session expirée (retour à la
 * connexion via `reportSessionExpiry`).
 */
export async function fetchVideoToken(roomId: string): Promise<VideoTokenResult> {
  let refreshed = false;
  for (;;) {
    let result: { data: any; error: any };
    try {
      result = await supabase!.functions.invoke('get-video-token', { body: videoJoinBody(roomId) });
    } catch {
      return unavailable();
    }
    const { data, error } = result;
    if (error) {
      const { status, body } = await readHttpError(error);
      if (status === 401) {
        if (!refreshed) {
          refreshed = true;
          if (await refreshSessionOnce()) continue;
        } else {
          reportSessionExpiry({ code: 'session_expired' });
        }
        return { ok: false, failure: videoFailure(401, body ?? {}) };
      }
      if (status === 403) return { ok: false, failure: videoFailure(403, body ?? {}) };
      return unavailable();
    }
    if (data?.success === false) return { ok: false, failure: videoFailure(403, data) };
    const session = asVideoSession(data);
    return session ? { ok: true, session } : unavailable();
  }
}
