import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mock firebase/firestore (same shape used across the app's unit tests) ---
const firestore = vi.hoisted(() => {
  const doc = vi.fn((_first: unknown, ...parts: string[]) => ({
    id: parts.at(-1),
    path: parts.join('/'),
  }));
  return {
    doc,
    getDoc: vi.fn(),
    setDoc: vi.fn(async () => {}),
    updateDoc: vi.fn(async () => {}),
    deleteDoc: vi.fn(async () => {}),
    serverTimestamp: vi.fn(() => ({ server: true })),
    collection: vi.fn((_db: unknown, path: string) => ({ path })),
    getDocs: vi.fn(async () => ({ empty: true, docs: [], size: 0 })),
    query: vi.fn((..._args: unknown[]) => ({})),
  };
});

// --- Mock firebase/messaging (new for push) ---
const messaging = vi.hoisted(() => ({
  getMessaging: vi.fn(() => ({})),
  getToken: vi.fn(async () => 'fcm-token-123'),
  deleteToken: vi.fn(async () => true),
  isSupported: vi.fn(async () => true),
  onMessage: vi.fn(() => () => {}),
  onTokenRefresh: vi.fn(() => () => {}),
}));

vi.mock('firebase/firestore', () => ({ ...firestore }));
vi.mock('firebase/messaging', () => ({ ...messaging }));
vi.mock('./firebase', () => ({ app: { name: 'mock-app' }, db: { name: 'mock-db' } }));

import {
  isPushSupportedInBrowser,
  getPushPermissionState,
  getDeviceId,
  mapFcmErrorToFriendlyMessage,
  loadPushState,
  registerCurrentDevice,
  unregisterCurrentDevice,
  initForegroundMessaging,
} from './pushNotifications';

const DEVICE_ID_KEY = 'fq_push_device_id';
const TOKEN_ID_KEY = 'fq_push_device_token_id';

function enablePushSupport(permission: 'default' | 'granted' | 'denied' = 'default') {
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { register: vi.fn(async () => ({})) },
    configurable: true,
    writable: true,
  });
  (window as unknown as { PushManager: unknown }).PushManager = class {};
  class FakeNotification {
    static permission = permission;
    static requestPermission = vi.fn(async () =>
      permission === 'denied' ? 'denied' : 'granted',
    );
  }
  Object.defineProperty(window, 'Notification', {
    value: FakeNotification,
    configurable: true,
    writable: true,
  });
}

function disablePushSupport() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (navigator as any).serviceWorker;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).PushManager;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).Notification;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  disablePushSupport();
  vi.stubEnv('VITE_FIREBASE_VAPID_KEY', 'test-vapid-key');
  firestore.getDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
});

afterEach(() => {
  vi.unstubAllEnvs();
  disablePushSupport();
});

describe('isPushSupportedInBrowser', () => {
  it('returns false when serviceWorker / PushManager / Notification are absent', () => {
    expect(isPushSupportedInBrowser()).toBe(false);
  });

  it('returns true when serviceWorker, PushManager and Notification are present', () => {
    enablePushSupport();
    expect(isPushSupportedInBrowser()).toBe(true);
  });
});

describe('getPushPermissionState', () => {
  it('returns unsupported when push is not supported', () => {
    expect(getPushPermissionState()).toBe('unsupported');
  });

  it('reflects Notification.permission (granted / denied / default)', () => {
    enablePushSupport('granted');
    expect(getPushPermissionState()).toBe('granted');
    disablePushSupport();
    enablePushSupport('denied');
    expect(getPushPermissionState()).toBe('denied');
    disablePushSupport();
    enablePushSupport('default');
    expect(getPushPermissionState()).toBe('default');
  });
});

describe('getDeviceId', () => {
  it('returns a stable id stored in localStorage across calls', () => {
    const first = getDeviceId();
    const second = getDeviceId();
    expect(first).toBe(second);
    expect(localStorage.getItem(DEVICE_ID_KEY)).toBe(first);
  });

  it('creates a new id when none is stored', () => {
    const id = getDeviceId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });
});

describe('mapFcmErrorToFriendlyMessage', () => {
  it('maps permission-blocked to a friendly message', () => {
    expect(mapFcmErrorToFriendlyMessage({ code: 'messaging/permission-blocked' })).toMatch(
      /blocked/i,
    );
  });

  it('maps token-subscribe failures to a friendly message', () => {
    expect(
      mapFcmErrorToFriendlyMessage({ code: 'messaging/token-subscribe-failed' }),
    ).toMatch(/register/i);
  });

  it('falls back to a generic message for unknown errors', () => {
    expect(mapFcmErrorToFriendlyMessage({ code: 'some/unknown' })).toMatch(/try again/i);
  });
});

describe('loadPushState', () => {
  it('returns unsupported when the browser lacks push support', async () => {
    const state = await loadPushState('fam1', 'u1');
    expect(state.support).toBe('unsupported');
    expect(state.status).toBe('unsupported');
  });

  it('returns blocked when notifications are denied', async () => {
    enablePushSupport('denied');
    const state = await loadPushState('fam1', 'u1');
    expect(state.status).toBe('blocked');
  });

  it('returns not_enabled when no device token is recorded locally', async () => {
    enablePushSupport('default');
    const state = await loadPushState('fam1', 'u1');
    expect(state.status).toBe('not_enabled');
  });

  it('returns enabled when the token document exists and is enabled', async () => {
    enablePushSupport('granted');
    localStorage.setItem(TOKEN_ID_KEY, 'tok1');
    firestore.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ enabled: true, lastSeenAt: { toMillis: () => 123 } }),
    });
    const state = await loadPushState('fam1', 'u1');
    expect(state.status).toBe('enabled');
    expect(state.lastRegisteredAt).toBe(123);
  });

  it('returns not_enabled when the token document is missing or disabled', async () => {
    enablePushSupport('granted');
    localStorage.setItem(TOKEN_ID_KEY, 'tok1');
    firestore.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ enabled: false }),
    });
    const state = await loadPushState('fam1', 'u1');
    expect(state.status).toBe('not_enabled');
  });
});

describe('registerCurrentDevice', () => {
  it('returns unsupported (no permission request) when push is unsupported', async () => {
    const state = await registerCurrentDevice('fam1', 'u1');
    expect(state.status).toBe('unsupported');
    expect(messaging.getToken).not.toHaveBeenCalled();
  });

  it('returns blocked (no permission request) when notifications are denied', async () => {
    enablePushSupport('denied');
    const state = await registerCurrentDevice('fam1', 'u1');
    expect(state.status).toBe('blocked');
    expect(messaging.getToken).not.toHaveBeenCalled();
  });

  it('requests permission, obtains a token and writes a new token doc', async () => {
    enablePushSupport('default');
    const state = await registerCurrentDevice('fam1', 'u1');
    expect(state.status).toBe('enabled');
    expect(messaging.getToken).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ vapidKey: 'test-vapid-key' }),
    );
    expect(firestore.setDoc).toHaveBeenCalledTimes(1);
    expect(firestore.updateDoc).not.toHaveBeenCalled();
    expect(localStorage.getItem(TOKEN_ID_KEY)).not.toBeNull();
  });

  it('updates the existing token doc on token rotation (no duplicate)', async () => {
    enablePushSupport('granted');
    localStorage.setItem(TOKEN_ID_KEY, 'tok1');
    firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ enabled: true }) });
    await registerCurrentDevice('fam1', 'u1');
    expect(firestore.updateDoc).toHaveBeenCalledTimes(1);
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  it('registers the messaging SW at the scoped path and passes the registration to getToken', async () => {
    enablePushSupport('default');
    const registerSpy = (navigator as unknown as {
      serviceWorker: { register: ReturnType<typeof vi.fn> };
    }).serviceWorker.register;
    const fakeReg = { scope: '/firebase-messaging/', active: null };
    registerSpy.mockResolvedValueOnce(fakeReg);
    await registerCurrentDevice('fam1', 'u1');
    expect(registerSpy).toHaveBeenCalledWith('/firebase-messaging/firebase-messaging-sw.js', {
      scope: '/firebase-messaging/',
    });
    expect(messaging.getToken).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ serviceWorkerRegistration: fakeReg }),
    );
  });

  it('logs and returns unavailable when the SW registration is null', async () => {
    enablePushSupport('default');
    const registerSpy = (navigator as unknown as {
      serviceWorker: { register: ReturnType<typeof vi.fn> };
    }).serviceWorker.register;
    registerSpy.mockResolvedValueOnce(null);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const state = await registerCurrentDevice('fam1', 'u1');
    expect(state.status).toBe('unavailable');
    expect(errorSpy).toHaveBeenCalled();
    expect(messaging.getToken).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('unregisterCurrentDevice', () => {
  it('deletes the token doc, clears local state and revokes the FCM token', async () => {
    enablePushSupport('granted');
    localStorage.setItem(TOKEN_ID_KEY, 'tok1');
    await unregisterCurrentDevice('fam1', 'u1');
    expect(messaging.deleteToken).toHaveBeenCalled();
    expect(firestore.deleteDoc).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(TOKEN_ID_KEY)).toBeNull();
  });
});

describe('initForegroundMessaging', () => {
  it('returns an unsubscribe function and never throws when unsupported', async () => {
    const unsub = await initForegroundMessaging();
    expect(typeof unsub).toBe('function');
  });

  it('returns an unsubscribe function when supported', async () => {
    enablePushSupport('granted');
    const unsub = await initForegroundMessaging();
    expect(typeof unsub).toBe('function');
    expect(messaging.onMessage).toHaveBeenCalled();
  });
});
