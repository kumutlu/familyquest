import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /(?:onboarding|onboardingLoop|routing)\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5176',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: process.env.ONBOARDING_GATE_BROWSER === 'webkit'
    ? [{ name: 'webkit', use: { ...devices['Desktop Safari'] } }]
    : process.env.ONBOARDING_GATE_BROWSER === 'chromium'
      ? [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
      : [
          { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        ],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${process.env.PLAYWRIGHT_VITE_PORT ?? '5176'}`,
    url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5176',
    reuseExistingServer: false,
  },
});
