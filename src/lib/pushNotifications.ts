// ---------------------------------------------------------------------------
// FAMILYQUEST — WEB PUSH NOTIFICATIONS (CLIENT)
// ---------------------------------------------------------------------------
//
// Focused client module. Responsibilities:
//  - feature-detect browser / service-worker / notification support
//  - request permission ONLY on an explicit user gesture (Enable button)
//  - register the device with the scoped Firebase Messaging service worker
//  - obtain an FCM token with the public VAPID key and persist it securely
//  - dedupe / refresh the same device registration
//  - disable the current device on sign-out or family change
//  - expose capability + state to Settings
//  - handle foreground messages WITHOUT showing a duplicate browser card
//
// It never sends pushes itself; delivery is a trusted Cloud Function.
// ---------------------------------------------------------------------------

import {
  getMessaging,
  getToken,
  deleteToken,
  isSupported as messagingIsSupported,
  onMessage,
  type Messaging,
} from 'firebase/messaging';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  collection,
  getDocs,
  query,
} from 'firebase/firestore';
import { app, db } from './firebase';

const SW_PATH = '/firebase-messaging/firebase-messaging-sw.js';
const SW_SCOPE = '/firebase-messaging/';
const DEVICE_ID_KEY = 'fq_push_device_id';
const TOKEN_ID_KEY = 'fq_push_device_token_id';

export type PushSupport = 'unsupported' | 'supported';
export type PushPermission = 'unsupported' | 'default' | 'granted' | 'denied';
export type PushDeviceStatus = 'unsupported' | 'not_enabled' | 'enabled' | 'blocked' | 'unavailable';

export interface PushState {
  support: PushSupport;
  permission: PushPermission;
  status: PushDeviceStatus;
  lastRegisteredAt: number | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// PURE HELPERS (exported for tests)
// ---------------------------------------------------------------------------

/** Browser feature detection. Safe to call during module load. */
export function isPushSupportedInBrowser(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Current permission state, or 'unsupported' when push is unavailable. */
export function getPushPermissionState(): PushPermission {
  if (!isPushSupportedInBrowser()) return 'unsupported';
  const permission = (window as unknown as { Notification?: { permission?: string } }).Notification
    ?.permission;
  if (permission === 'granted') return 'granted';
  if (permission === 'denied') return 'denied';
  return 'default';
}

/**
 * Stable per-browser-device identifier stored in localStorage. Used as the
 * Firestore token document id so re-registration / token rotation updates the
 * same record instead of creating duplicates. It does NOT contain the raw FCM
 * token.
 */
export function getDeviceId(): string {
  if (typeof localStorage === 'undefined') return 'anon-device';
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = `dev_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

/** Map Firebase / browser errors to friendly, non-technical messages. */
export function mapFcmErrorToFriendlyMessage(error: unknown): string {
  const raw = (error as { code?: string; message?: string })?.code ||
    (error as { message?: string })?.message ||
    '';
  if (typeof raw === 'string') {
    if (raw.includes('permission-blocked')) {
      return 'Notifications are blocked in your browser or device settings.';
    }
    if (raw.includes('permission-default')) {
      return 'Please allow notifications to enable push.';
    }
    if (raw.includes('token-subscribe-failed') || raw.includes('token-subscribe')) {
      return 'Could not register this device for push notifications. Try again.';
    }
    if (raw.includes('unsupported-browser')) {
      return 'This browser does not support push notifications.';
    }
    if (raw.includes('notifications-blocked')) {
      return 'Notifications are blocked. Enable them in your browser settings, then return here.';
    }
  }
  return 'Could not enable push notifications right now. Try again.';
}

// ---------------------------------------------------------------------------
// INTERNAL HELPERS
// ---------------------------------------------------------------------------

function unavailableState(error: string): PushState {
  return {
    support: isPushSupportedInBrowser() ? 'supported' : 'unsupported',
    permission: getPushPermissionState(),
    status: 'unavailable',
    lastRegisteredAt: null,
    error,
  };
}

function detectPlatform(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent || '';
  return /Mobi|Android|iPhone|iPad/i.test(ua) ? 'mobile' : 'desktop';
}

function detectBrowser(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent || '';
  if (/Edg\//.test(ua)) return 'edge';
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return 'chrome';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'safari';
  return 'other';
}

function userAgentSummary(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  return (navigator.userAgent || 'unknown').slice(0, 200);
}

function deviceLabel(): string {
  return `${detectBrowser()} on ${detectPlatform()}`;
}

function getVapidKey(): string | undefined {
  return (import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined) || undefined;
}

let messagingInstance: Messaging | null = null;

async function getMessagingInstance(): Promise<Messaging | null> {
  if (!isPushSupportedInBrowser()) return null;
  if (!(await messagingIsSupported())) return null;
  if (!messagingInstance) messagingInstance = getMessaging(app);
  return messagingInstance;
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.register(SW_PATH, { scope: SW_SCOPE });
}

// ---------------------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------------------

/**
 * Register the current device for push. MUST be called from a user gesture
 * (the Settings Enable button). Requests permission, registers the SW, obtains
 * an FCM token, and persists it under the current user + family.
 */
export async function registerCurrentDevice(
  familyId: string,
  userId: string,
): Promise<PushState> {
  if (!isPushSupportedInBrowser()) {
    return {
      support: 'unsupported',
      permission: 'unsupported',
      status: 'unsupported',
      lastRegisteredAt: null,
      error: null,
    };
  }

  const permission = getPushPermissionState();
  if (permission === 'denied') {
    return {
      support: 'supported',
      permission: 'denied',
      status: 'blocked',
      lastRegisteredAt: null,
      error: 'Notifications are blocked in your browser or device settings.',
    };
  }

  // Only request permission when the user has not already granted it.
  let granted: PushPermission = permission;
  if (permission === 'default') {
    const result = await (window as unknown as {
      Notification: { requestPermission: () => Promise<NotificationPermission> };
    }).Notification.requestPermission();
    granted = result === 'granted' ? 'granted' : 'denied';
    if (granted !== 'granted') {
      return {
        support: 'supported',
        permission: granted,
        status: 'blocked',
        lastRegisteredAt: null,
        error: 'Notifications are blocked in your browser or device settings.',
      };
    }
  }

  try {
    const reg = await registerServiceWorker();
    if (!reg) {
      // Surface a clear, actionable error when the messaging service worker
      // could not be registered (e.g. it was rewritten to index.html by hosting
      // config, or the file is missing). The real exception is logged below.
      const err = new Error(
        'Firebase Messaging service worker registration failed; push cannot be enabled.',
      );
      // eslint-disable-next-line no-console
      console.error('[push] service-worker-registration-failed', err);
      return unavailableState(mapFcmErrorToFriendlyMessage(err));
    }
    const messaging = await getMessagingInstance();
    if (!messaging) return unavailableState('Push is not available in this browser.');

    const vapidKey = getVapidKey();
    if (!vapidKey) return unavailableState('Push is not configured for this environment.');

    // TEMP DEBUG: diagnose InvalidAccessError (applicationServerKey must contain a valid P-256 public key)
    // eslint-disable-next-line no-console
    console.log('[push] vapidKey', vapidKey);
    // eslint-disable-next-line no-console
    console.log('[push] vapidLength', vapidKey?.length);
    // eslint-disable-next-line no-console
    console.log('[push] rawVapidEnv', (import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined));

    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: reg,
    });
    if (!token) return unavailableState('Could not obtain a push token. Try again.');

    const tokenId = getDeviceId();
    const ref = doc(db, 'families', familyId, 'users', userId, 'push_tokens', tokenId);
    const existing = await getDoc(ref);
    const now = serverTimestamp();
    const base = {
      userId,
      familyId,
      token,
      platform: detectPlatform(),
      browser: detectBrowser(),
      enabled: true,
      permission: 'granted',
      appVersion: 'familyquest-web',
      userAgentSummary: userAgentSummary(),
      updatedAt: now,
      lastSeenAt: now,
    };

    if (existing.exists()) {
      // Refresh: update the same device record (token rotation safe).
      await updateDoc(ref, base);
    } else {
      await setDoc(ref, { ...base, createdAt: now, deviceLabel: deviceLabel() });
    }

    if (typeof localStorage !== 'undefined') localStorage.setItem(TOKEN_ID_KEY, tokenId);
    return {
      support: 'supported',
      permission: 'granted',
      status: 'enabled',
      lastRegisteredAt: Date.now(),
      error: null,
    };
  } catch (err) {
    // Log the exact exception (not just the reduced friendly message) so the
    // real cause of a registration / token failure is diagnosable in production.
    // eslint-disable-next-line no-console
    console.error('[push] registerCurrentDevice-failed', err);
    return unavailableState(mapFcmErrorToFriendlyMessage(err));
  }
}

/** Disable / remove the current device's push token (sign-out, Disable button). */
export async function unregisterCurrentDevice(
  familyId: string,
  userId: string,
): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  const tokenId = localStorage.getItem(TOKEN_ID_KEY);
  if (!tokenId) return;

  try {
    const messaging = await getMessagingInstance();
    if (messaging) {
      try {
        await deleteToken(messaging);
      } catch {
        // best-effort; the Firestore record is the source of truth.
      }
    }
  } catch {
    // ignore
  }

  const ref = doc(db, 'families', familyId, 'users', userId, 'push_tokens', tokenId);
  await deleteDoc(ref).catch(() => undefined);
  if (typeof localStorage !== 'undefined') localStorage.removeItem(TOKEN_ID_KEY);
}

/**
 * Remove all of the current user's tokens under a (previous) family. Called
 * while the user is still a member of that family, e.g. just before a family
 * switch, so the old-family token does not linger.
 */
export async function detachOldFamilyTokens(
  oldFamilyId: string,
  userId: string,
): Promise<number> {
  const col = collection(db, 'families', oldFamilyId, 'users', userId, 'push_tokens');
  const snap = await getDocs(query(col));
  if (snap.empty) return 0;
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref).catch(() => undefined)));
  if (typeof localStorage !== 'undefined') localStorage.removeItem(TOKEN_ID_KEY);
  return snap.size;
}

/**
 * Load the current device's push state for Settings. Source of truth is the
 * Firestore token document; localStorage only identifies "this device".
 */
export async function loadPushState(
  familyId: string | null | undefined,
  userId: string | null | undefined,
): Promise<PushState> {
  const support = isPushSupportedInBrowser() ? 'supported' : 'unsupported';
  const permission = getPushPermissionState();

  if (support === 'unsupported') {
    return { support: 'unsupported', permission: 'unsupported', status: 'unsupported', lastRegisteredAt: null, error: null };
  }
  if (permission === 'denied') {
    return {
      support,
      permission: 'denied',
      status: 'blocked',
      lastRegisteredAt: null,
      error: 'Notifications are blocked in your browser or device settings.',
    };
  }
  if (!familyId || !userId) {
    return { support, permission, status: 'not_enabled', lastRegisteredAt: null, error: null };
  }

  const tokenId = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_ID_KEY) : null;
  if (!tokenId) {
    return { support, permission, status: 'not_enabled', lastRegisteredAt: null, error: null };
  }

  const ref = doc(db, 'families', familyId, 'users', userId, 'push_tokens', tokenId);
  const snap = await getDoc(ref);
  if (!snap.exists() || !(snap.data() as { enabled?: boolean }).enabled) {
    return { support, permission, status: 'not_enabled', lastRegisteredAt: null, error: null };
  }

  const data = snap.data() as { lastSeenAt?: { toMillis?: () => number } | number };
  const lastRegisteredAt =
    typeof data.lastSeenAt === 'number'
      ? data.lastSeenAt
      : data.lastSeenAt?.toMillis
        ? data.lastSeenAt.toMillis()
        : null;

  return { support, permission: 'granted', status: 'enabled', lastRegisteredAt, error: null };
}

/**
 * Wire foreground message handling. The realtime Notification Center (Firestore
 * listener) is the primary UI, so we intentionally do NOT show a duplicate
 * browser notification here. Returns an unsubscribe function.
 */
export async function initForegroundMessaging(): Promise<() => void> {
  const messaging = await getMessagingInstance();
  if (!messaging) return () => undefined;
  const unsub = onMessage(messaging, () => {
    // No-op: avoid duplicate browser notification; Notification Center handles it.
  });
  return typeof unsub === 'function' ? unsub : () => undefined;
}

/**
 * FCM token rotation: the Firebase JS SDK (v12) refreshes the registration
 * token automatically and reuses the same token string where possible. Because
 * `registerCurrentDevice` upserts the SAME per-device document (keyed by the
 * stable device id), simply calling it again — e.g. on app start when a token
 * already exists — re-persists the current token and keeps the record fresh.
 * No separate token-refresh listener is required.
 */
