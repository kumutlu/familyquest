import { defineConfig, devices } from '@playwright/test';

// Production smoke-test config: runs the web app against the LIVE
// familyquest-beta-402cb project (NO Firebase emulator). The app's
// src/lib/firebase.ts only connects to the emulator when
// VITE_USE_FIREBASE_EMULATOR === 'true'; by omitting that flag the
// app uses the production Firebase project from .env.
export default defineConfig({
  testDir: './tests/e2e',
  // Only run the production smoke spec. Other e2e specs import firebase-admin
  // (seed.ts), which crashes Playwright's loader with a jwks-rsa ESM cache
  // error at startup. The smoke spec deliberately avoids admin.
  testMatch: /production-smoke\.spec\.ts$/,
  timeout: 30 * 1000,
  expect: { timeout: 8000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    actionTimeout: 0,
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // NOTE: no VITE_USE_FIREBASE_EMULATOR flag → production Firebase.
    command: 'npm run dev -- --port 5174',
    port: 5174,
    reuseExistingServer: !process.env.CI,
  },
});
