import { execSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { expectOwnerReady } from './utils/readiness';

test.beforeEach(() => execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' }));

test('real emulator password reset action rejects old password and accepts new password', async ({ page, context }) => {
  const email = `reset-${Date.now()}@example.com`;
  const oldPassword = 'oldPassword123!';
  const newPassword = 'newPassword456!';

  // 1. Create a seed account with oldPassword and trigger reset email in emulator
  execSync('npx tsx tests/e2e/utils/seedPasswordReset.ts', {
    stdio: 'inherit',
    env: { ...process.env, RESET_EMAIL: email, RESET_PASSWORD: oldPassword },
  });

  // 2. Read password reset link from emulator
  const resetLink = execSync('npx tsx tests/e2e/utils/readPasswordResetLink.ts', {
    encoding: 'utf8',
    env: { ...process.env, RESET_EMAIL: email },
  });
  const firebaseAction = new URL(resetLink.trim());
  const handlerSearch = new URLSearchParams({
    mode: firebaseAction.searchParams.get('mode') ?? 'resetPassword',
    oobCode: firebaseAction.searchParams.get('oobCode') ?? '',
    lang: firebaseAction.searchParams.get('lang') ?? 'en',
  });

  // 3. Open reset link page
  const resetPage = await context.newPage();
  await resetPage.goto(`/auth/action?${handlerSearch}`);
  await expect(resetPage.getByRole('heading', { name: /reset your password/i })).toBeVisible();
  await expect(resetPage.getByText(/choose a new password/i)).toBeVisible();

  // 4. Submit new password
  await resetPage.locator('input[aria-label="New password"]').fill(newPassword);
  await resetPage.getByRole('button', { name: /save password/i }).click();
  await expect(resetPage.getByText(/your password has been reset/i)).toBeVisible();
  await resetPage.close();

  // 5. Try signing in with OLD password on /login -> MUST FAIL
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(oldPassword);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.locator('[role="alert"]')).toBeVisible({ timeout: 10_000 });
  expect(page.url()).toContain('/login');

  // 6. Try signing in with NEW password on /login -> MUST SUCCEED
  await page.locator('input[type="password"]').fill(newPassword);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expectOwnerReady(page);
});
