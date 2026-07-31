import { defineConfig, devices } from '@playwright/test';

// Production smoke-test config: runs the authenticated smoke suite against the
// LIVE deployment at https://queki.app (NO Firebase emulator). The deployed
// site is already wired to the production familyquest-beta-402cb project.
//
// Base URL resolution (in priority order):
//   1. QUEKI_SMOKE_BASE_URL         — explicit override
//   2. https://queki.app            — default live production target
//
// Local testing: set QUEKI_SMOKE_BASE_URL=http://localhost:5174 and start the
// dev server yourself (`npm run dev -- --port 5174` without the emulator flag,
// so the local app talks to production Firebase). No webServer is started
// automatically here, to guarantee the "production" run really targets the
// deployed site unless a local URL is explicitly requested.
//
// Credentials are supplied via environment variables (never committed):
//   QUEKI_SMOKE_PARENT_EMAIL / QUEKI_SMOKE_PARENT_PASSWORD
//   QUEKI_SMOKE_CHILD_EMAIL  / QUEKI_SMOKE_CHILD_PASSWORD
//   QUEKI_SMOKE_UNRELATED_EMAIL (optional, isolation checks)
//
// Run: npm run test:smoke
const baseURL = process.env.QUEKI_SMOKE_BASE_URL || 'https://queki.app';

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
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // No webServer: the production suite must hit the deployed site. For local
  // runs, export QUEKI_SMOKE_BASE_URL=http://localhost:5174 and run the dev
  // server manually.
});
