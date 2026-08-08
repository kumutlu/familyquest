import { defineConfig, devices } from '@playwright/test';

/**
 * Permanent mobile regression suite.
 *
 * Runs tests/e2e/mobile-family-nav.spec.ts at two iPhone viewports with real
 * touch input enabled. Point it at the dev server (default) or at a production
 * preview build via QUEKI_MOBILE_BASE_URL.
 *
 *   Dev:      npm run test:e2e:mobile
 *   Preview:  QUEKI_MOBILE_BASE_URL=http://localhost:5175 \
 *             npx playwright test --config playwright.mobile.config.ts
 */
const baseURL = process.env.QUEKI_MOBILE_BASE_URL || 'http://localhost:5174';
const usesExternalServer = !!process.env.QUEKI_MOBILE_BASE_URL;

const touch = { hasTouch: true, isMobile: true, deviceScaleFactor: 3 };

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /mobile-.*\.spec\.ts/,
  timeout: 90 * 1000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-mobile' }]],
  outputDir: 'test-results/mobile-artifacts',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'iphone-390x844',
      use: { ...devices['Desktop Chrome'], ...touch, viewport: { width: 390, height: 844 } },
    },
    {
      name: 'iphone-430x932',
      use: { ...devices['Desktop Chrome'], ...touch, viewport: { width: 430, height: 932 } },
    },
  ],
  ...(usesExternalServer
    ? {}
    : {
        webServer: {
          command: 'VITE_USE_FIREBASE_EMULATOR=true npm run dev -- --port 5174',
          port: 5174,
          reuseExistingServer: true,
        },
      }),
});
