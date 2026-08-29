import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.QUEKI_E2E_BASE_URL || 'http://localhost:5174';
const usesExternalServer = !!process.env.QUEKI_E2E_BASE_URL;

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests/e2e',
  /* The mobile regression suite has its own config (playwright.mobile.config.ts). */
  testIgnore: /mobile-.*\.spec\.ts/,
  // Adult invitation tests are also selected explicitly by the mobile config;
  // keep the default project desktop-only for the regular E2E matrix.
  /* Maximum time one test can run for. */
  timeout: 30 * 1000,
  expect: {
    /**
     * Maximum time expect() should wait for the condition to be met.
     */
    timeout: 5000
  },
  /* Run tests in files in parallel */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests to avoid database collision in the emulator. */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Maximum time each action such as `click()` can take. Defaults to 0 (no limit). */
    actionTimeout: 0,
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Run your local dev server before starting the tests */
  ...(usesExternalServer
    ? {}
    : {
        webServer: {
          command: 'VITE_USE_FIREBASE_EMULATOR=true npm run dev -- --port 5174',
          port: 5174,
          reuseExistingServer: !process.env.CI,
        },
      }),
});
