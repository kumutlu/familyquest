import base from './playwright.config';
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  ...base,
  testMatch: /(?:email-verification|password-reset)\.spec\.ts/,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
