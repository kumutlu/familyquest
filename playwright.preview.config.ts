import { defineConfig, devices } from '@playwright/test';

/**
 * Runs the e2e specs against a PRODUCTION BUILD (`vite build` + `vite preview`)
 * instead of the dev server, so we can prove that minified/production output
 * behaves identically to development.
 *
 * Usage:
 *   VITE_USE_FIREBASE_EMULATOR=true npm run build
 *   npx vite preview --port 5175
 *   npx playwright test --config playwright.preview.config.ts
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60 * 1000,
  expect: { timeout: 8000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: process.env.QUEKI_PREVIEW_BASE_URL || 'http://localhost:5175',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
