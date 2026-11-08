import { PermissionsAndroid, Platform } from 'react-native';

/**
 * Permissions caméra + micro de la téléconsultation (WebView).
 * - Android : demandées à l'exécution (`CAMERA`, `RECORD_AUDIO`, déclarées dans app.json) AVANT d'ouvrir la salle ;
 *   sans cela `getUserMedia` échoue dans la WebView.
 * - iOS : l'invite système est déclenchée par la WebView elle-même (`NSCameraUsageDescription` /
 *   `NSMicrophoneUsageDescription` dans app.json, `mediaCapturePermissionGrantType`).
 * Non vérifié sur appareil.
 */
export type CallPermission = 'granted' | 'denied' | 'blocked';

export async function requestCallPermissions(): Promise<CallPermission> {
  if (Platform.OS !== 'android') return 'granted';
  try {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.CAMERA,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    ]);
    const values = Object.values(result);
    if (values.every((v) => v === PermissionsAndroid.RESULTS.GRANTED)) return 'granted';
    return values.some((v) => v === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) ? 'blocked' : 'denied';
  } catch {
    return 'denied';
  }
}
