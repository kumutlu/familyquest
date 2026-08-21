import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { loginAs, logout } from './utils/auth';
import { seedTestFamily } from './utils/seed';
import { collectE2ETimeline } from './utils/timeline';

/**
 * Option A routing regression: Refined Queki onboarding is the public front
 * door for a signed-out visitor opening the bare app URL, while protected
 * deep links, returning users, sign-out, owner and managed-child behaviour
 * are all preserved.
 *
 * Requires the Firebase emulator suite (firestore, auth, functions) — run via
 * `npm run test:e2e`.
 */
test.describe('Public routing — Refined Queki front door', () => {
  let finishTimeline: ((testInfo: import('@playwright/test').TestInfo) => Promise<void>) | undefined;
  test.beforeEach(async ({ page }) => {
    finishTimeline = collectE2ETimeline(page);
    execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
  });
  test.afterEach(async ({}, testInfo) => finishTimeline?.(testInfo));

  test('1. clean visitor at / lands on Refined Step 1 (onboarding)', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /small wins\. big habits\./i }),
    ).toBeVisible({ timeout: 15000 });
  });

  test('2. Step 1 "I already have an account" escapes to /login', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /small wins\. big habits\./i }),
    ).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: /i already have an account/i }).click();

    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test('3. existing owner never sees onboarding', async ({ page }) => {
    await loginAs(page, 'owner@test.com');
    await page.goto('/onboarding');

    // Owner is redirected out of onboarding into the application.
    await expect(page).not.toHaveURL(/\/onboarding/);
    await expect(
      page.getByRole('heading', { name: /small wins\. big habits\./i }),
    ).toHaveCount(0);
  });

  test('4. managed child never sees parent onboarding', async ({ page }) => {
    await loginAs(page, 'child@test.com');
    await page.goto('/onboarding');

    await expect(page).not.toHaveURL(/\/onboarding/);
    await expect(
      page.getByRole('heading', { name: /small wins\. big habits\./i }),
    ).toHaveCount(0);
  });

  test('5. sign out ends at /login', async ({ page }) => {
    await loginAs(page, 'owner@test.com');
    await logout(page);
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
  });

  test('6. protected deep link still routes a signed-out user to Login', async ({ page }) => {
    await page.goto('/wallet');
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });
});
