import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

// Required VITE_FIREBASE_* variables. If any are missing the app must fail
// loudly at startup instead of letting Firebase throw auth/invalid-api-key
// (which previously produced a white screen on the login route).
const REQUIRED_FIREBASE_VARS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

function validateFirebaseEnv(): {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
} {
  const missing = REQUIRED_FIREBASE_VARS.filter(
    (name) => !import.meta.env[name]
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing Firebase configuration:\n${missing.map((name) => `- ${name}`).join('\n')}`
    );
  }

  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
    appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID as string | undefined,
  };
}

const firebaseConfig = validateFirebaseEnv();

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Preserve the already-authorized profile/family snapshots across a page
// replacement (including Safari's first launch after a Hosting deployment).
// The startup store accepts only the authenticated user's exact profile and
// family generation, while live listeners/server reads remain authoritative.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const googleProvider = new GoogleAuthProvider();
// All callable functions are deployed with setGlobalOptions({ region:
// 'europe-west1' }). The Functions client otherwise defaults to us-central1,
// which turns every callable request into a 404 / functions/not-found.
export const FIREBASE_FUNCTIONS_REGION = 'europe-west1';
export const functions = getFunctions(app, FIREBASE_FUNCTIONS_REGION);

if (import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}

// Dev-only startup trace: marks the moment the Firebase app/auth/db handles are
// ready. Mirrors the `[auth-trace]` format used by logAuthTrace in useStore so
// the full startup can be measured end-to-end. No tokens or config are logged.
if (import.meta.env?.DEV) {
  // eslint-disable-next-line no-console
  console.info('[auth-trace]', new Date().toISOString(), 'firebase-initialized', {});
}
