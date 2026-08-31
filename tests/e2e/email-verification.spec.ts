import { execSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { countFamiliesForE2E } from './utils/adultInvite';

test.beforeEach(() => execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' }));

test('unverified password signup cannot bypass family authority and resumes after verification', async ({ page }) => {
  const email = `verify-${Date.now()}@example.com`;
  const familyCountBeforeAuth = await countFamiliesForE2E();
  await page.goto('/signup');
  await page.locator('input[type="text"]').fill('Pending Parent');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill('password123');
  await page.getByRole('button', { name: /^sign up$/i }).click();

  await expect(page).toHaveURL(/\/verify-email$/);
  await expect(page.getByRole('heading', { name: /verify your email/i })).toBeVisible();
  expect(await countFamiliesForE2E()).toBe(familyCountBeforeAuth);
  await page.reload();
  await expect(page).toHaveURL(/\/verify-email$/);
  await expect(page.getByRole('heading', { name: /verify your email/i })).toBeVisible();

  execSync('npx tsx tests/e2e/utils/verifyEmail.ts', {
    stdio: 'ignore', env: { ...process.env, ONBOARDING_EMAIL: email },
  });
  await page.getByRole('button', { name: /i've verified my email/i }).click();
  await expect(page).toHaveURL(/\/no-family$/);
  expect(await countFamiliesForE2E()).toBe(familyCountBeforeAuth);
});
