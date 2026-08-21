import { beforeEach, describe, expect, it, vi } from 'vitest';

const getFunctions = vi.fn(() => ({ kind: 'functions' }));
const initializeFirestore = vi.fn(() => ({ kind: 'firestore' }));
const persistentLocalCache = vi.fn(() => ({ kind: 'persistent-cache' }));
const persistentMultipleTabManager = vi.fn(() => ({ kind: 'multi-tab' }));

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({ kind: 'app' })),
}));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({ kind: 'auth' })),
  GoogleAuthProvider: vi.fn(),
  connectAuthEmulator: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({ kind: 'memory-firestore' })),
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator: vi.fn(),
}));
vi.mock('firebase/functions', () => ({
  getFunctions,
  connectFunctionsEmulator: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  getFunctions.mockClear();
  initializeFirestore.mockClear();
  persistentLocalCache.mockClear();
  persistentMultipleTabManager.mockClear();
  vi.stubEnv('VITE_FIREBASE_API_KEY', 'api-key');
  vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'queki.app');
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'familyquest-beta-402cb');
  vi.stubEnv('VITE_FIREBASE_STORAGE_BUCKET', 'bucket');
  vi.stubEnv('VITE_FIREBASE_MESSAGING_SENDER_ID', 'sender');
  vi.stubEnv('VITE_FIREBASE_APP_ID', 'app-id');
});

describe('Firebase Functions configuration', () => {
  it('targets the region where managed-child callables are deployed', async () => {
    await import('./firebase');

    expect(getFunctions).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'app' }),
      'europe-west1',
    );
  });
});

describe('Firestore deployment-transition cache', () => {
  it('persists trusted profile/family snapshots across a Safari page replacement', async () => {
    await import('./firebase');

    expect(persistentMultipleTabManager).toHaveBeenCalledOnce();
    expect(persistentLocalCache).toHaveBeenCalledWith({ tabManager: { kind: 'multi-tab' } });
    expect(initializeFirestore).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'app' }),
      { localCache: { kind: 'persistent-cache' } },
    );
  });

  it('forces long polling only for the emulator test path', async () => {
    vi.stubEnv('VITE_USE_FIREBASE_EMULATOR', 'true');
    vi.stubEnv('VITE_FIRESTORE_EMULATOR_HOST', '127.0.0.1');
    vi.stubEnv('VITE_FIRESTORE_EMULATOR_PORT', '18080');

    await import('./firebase');

    expect(initializeFirestore).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'app' }),
      {
        localCache: { kind: 'persistent-cache' },
        experimentalForceLongPolling: true,
      },
    );
  });

  it('does not enable emulator transport overrides in production', async () => {
    vi.stubEnv('VITE_USE_FIREBASE_EMULATOR', 'false');

    await import('./firebase');

    expect(initializeFirestore).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'app' }),
      { localCache: { kind: 'persistent-cache' } },
    );
  });
});
