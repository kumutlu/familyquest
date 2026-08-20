import { defineConfig, devices } from '@playwright/test';

/**
 * Dedicated config for the PRE-DEPLOY service-worker lifecycle E2E gate.
 *
 * The spec (`tests/e2e/sw-lifecycle.spec.ts`) starts its own controllable static
 * server (sw-lifecycle-server.mjs) inside `beforeAll`, so no `webServer` is
 * declared here. It runs against the PRODUCTION-built preview artifacts produced
 * by `scripts/build-sw-e2e-artifacts.mjs` (e2e-artifacts/old + /new).
 *
 * Usage:
 *   node scripts/build-sw-e2e-artifacts.mjs
 *   npx playwright test --config playwright.sw-lifecycle.config.ts
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /sw-lifecycle\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['line'],
    ['json', { outputFile: 'playwright-report-sw-lifecycle/results.json' }],
  ],
  use: {
    baseURL: 'http://localhost:5175',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // WebKit is attempted for Safari-specific findings; see the final report.
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
