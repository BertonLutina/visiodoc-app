const mockRpc = jest.fn();
const mockMarkRead = jest.fn();

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.0.0', extra: { eas: { projectId: 'proj-1' } } } },
}));
const mockDevice = { isDevice: true, modelName: 'Pixel 8' };
jest.mock('expo-device', () => ({ __esModule: true, get isDevice() { return mockDevice.isDevice; }, get modelName() { return mockDevice.modelName; } }));
jest.mock('expo-notifications', () => ({
  AndroidImportance: { MAX: 5 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => {}),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  getLastNotificationResponseAsync: jest.fn(),
}));
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: any[]) => mockRpc(...a) } }));
jest.mock('@/services/notifications', () => ({
  ...jest.requireActual('@/services/notifications'),
  markNotificationRead: (...a: any[]) => mockMarkRead(...a),
}));

import * as Notifications from 'expo-notifications';
import {
  __resetPushStateForTests,
  handleNotificationResponse,
  listenForNotificationTaps,
  registerForPush,
  unregisterPush,
} from './pushNotifications';

const N = Notifications as any;
const TOKEN = 'ExponentPushToken[abc]';

beforeEach(() => {
  jest.clearAllMocks();
  __resetPushStateForTests();
  mockDevice.isDevice = true;
  N.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
  N.getExpoPushTokenAsync.mockResolvedValue({ data: TOKEN });
  mockRpc.mockResolvedValue({ error: null });
  mockMarkRead.mockResolvedValue(undefined);
});

describe('registerForPush', () => {
  it('enregistre le jeton avec le projectId et la plateforme', async () => {
    await expect(registerForPush()).resolves.toBe(TOKEN);
    expect(N.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-1' });
    expect(N.setNotificationChannelAsync).toHaveBeenCalled();
    expect(mockRpc).toHaveBeenCalledWith('register_push_token', {
      p_token: TOKEN,
      p_platform: 'android',
      p_device_name: 'Pixel 8',
      p_app_version: '1.0.0',
    });
  });

  it('demande la permission si elle n\'est pas encore accordée', async () => {
    N.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    N.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    await expect(registerForPush()).resolves.toBe(TOKEN);
    expect(N.requestPermissionsAsync).toHaveBeenCalled();
  });

  it('ne fait rien si la permission est refusée', async () => {
    N.getPermissionsAsync.mockResolvedValue({ status: 'denied' });
    N.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await expect(registerForPush()).resolves.toBeNull();
    expect(N.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('ignore les simulateurs', async () => {
    mockDevice.isDevice = false;
    await expect(registerForPush()).resolves.toBeNull();
    expect(N.getPermissionsAsync).not.toHaveBeenCalled();
  });

  it('ne plante pas si la RPC est absente ou en erreur', async () => {
    mockRpc.mockResolvedValue({ error: { message: 'function register_push_token does not exist' } });
    await expect(registerForPush()).resolves.toBeNull();
    mockRpc.mockRejectedValue(new Error('réseau'));
    await expect(registerForPush()).resolves.toBeNull();
  });

  it('ne plante pas si le jeton est indisponible (Expo Go Android, FCM absent)', async () => {
    N.getExpoPushTokenAsync.mockRejectedValue(new Error('FCM not configured'));
    await expect(registerForPush()).resolves.toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('unregisterPush', () => {
  it('désenregistre le jeton enregistré', async () => {
    await registerForPush();
    mockRpc.mockClear();
    await unregisterPush();
    expect(mockRpc).toHaveBeenCalledWith('unregister_push_token', { p_token: TOKEN });
  });

  it('ne fait rien sans jeton enregistré, et avale les erreurs', async () => {
    await unregisterPush();
    expect(mockRpc).not.toHaveBeenCalled();
    await registerForPush();
    mockRpc.mockRejectedValue(new Error('hors-ligne'));
    await expect(unregisterPush()).resolves.toBeUndefined();
  });
});

const response = (data: any, id = 'req-1') =>
  ({ actionIdentifier: 'default', notification: { request: { identifier: id, content: { data } } } }) as any;

describe('handleNotificationResponse', () => {
  it('marque la notification lue puis route par type', () => {
    const navigate = jest.fn();
    handleNotificationResponse(response({ type: 'prescription_issued', notificationId: 'n-1' }), 'patient', navigate);
    expect(mockMarkRead).toHaveBeenCalledWith('n-1');
    expect(navigate).toHaveBeenCalledWith('/records');
  });

  it('route selon le rôle prestataire', () => {
    const navigate = jest.fn();
    handleNotificationResponse(response({ type: 'avatar_review' }, 'req-2'), 'provider', navigate);
    expect(mockMarkRead).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/(provider)/profile');
  });

  it('ne navigue pas pour un type inconnu et ne traite un tap qu\'une fois', () => {
    const navigate = jest.fn();
    expect(handleNotificationResponse(response({ type: 'inconnu' }, 'req-3'), 'patient', navigate)).toBe(false);
    handleNotificationResponse(response({ type: 'consultation_started' }, 'req-4'), 'patient', navigate);
    handleNotificationResponse(response({ type: 'consultation_started' }, 'req-4'), 'patient', navigate);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});

describe('listenForNotificationTaps', () => {
  it('traite le tap qui a lancé l\'app et se désabonne', async () => {
    const remove = jest.fn();
    N.addNotificationResponseReceivedListener.mockReturnValue({ remove });
    N.getLastNotificationResponseAsync.mockResolvedValue(response({ type: 'provider_absent' }, 'req-5'));
    const navigate = jest.fn();
    const stop = listenForNotificationTaps('patient', navigate);
    await Promise.resolve();
    await Promise.resolve();
    expect(navigate).toHaveBeenCalledWith('/(patient)/wallet');
    stop();
    expect(remove).toHaveBeenCalled();
  });
});
