import { loadEnv } from 'vite';

const REQUIRED_FIREBASE_VARS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

function runPreflight() {
  const envPrefix = 'VITE_';
  const cwd = process.cwd();
  const productionEnv = loadEnv('production', cwd, envPrefix);
  const devEnv = { ...productionEnv, ...loadEnv('development', cwd, envPrefix) };

  const missing = REQUIRED_FIREBASE_VARS.filter((name) => !devEnv[name] && !process.env[name]);

  if (missing.length > 0) {
    console.error(`[PREFLIGHT FAILED] Missing required Firebase test environment variables:\n${missing.map((v) => `  - ${v}`).join('\n')}`);
    process.exit(1);
  }

  console.log('[PREFLIGHT SUCCESS] All required Firebase test environment variables are available.');
}

runPreflight();
