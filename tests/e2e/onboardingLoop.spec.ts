import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * P0 verification: creating a family must not bounce the parent back to the
 * Create Family screen (onboarding redirect loop).
 */

const PASSWORD = 'password123';

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`;
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(String(err)));
  return errors;
}

async function signUp(page: Page, email: string, name: string) {
  await page.goto('/signup');
  await page.locator('input[type="text"]').first().fill(name);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: /sign up/i }).click();
}

async function createFamily(page: Page, familyName: string) {
  await page.getByRole('button', { name: /create family/i }).click();
  await page.locator('input[type="text"]').first().fill(familyName);
  await page.getByRole('button', { name: /^continue$/i }).click();
}

async function expectDashboard(page: Page) {
  await expect(page).toHaveURL(/\/$|\/#?$/, { timeout: 15000 });
  await expect(page.getByRole('button', { name: /create family/i })).toHaveCount(0);
  await expect(page.getByRole('navigation').first()).toBeVisible({ timeout: 15000 });
}

async function signOutFromApp(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: /sign out|log out/i }).first().click();
  await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
}

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).first().click();
}

test('parent creates a family once and lands on the dashboard without a loop', async ({ page }) => {
  const errors = collectErrors(page);
  const email = uniqueEmail('parent');

  await signUp(page, email, 'Loop Parent');

  // Scenario 2: create family once
  await expect(page.getByRole('button', { name: /create family/i })).toBeVisible({ timeout: 20000 });
  await createFamily(page, 'Loop Family');

  // Scenario 3: dashboard opens immediately
  await expectDashboard(page);

  // Scenario 4/5: refresh stays on dashboard
  await page.reload();
  await expectDashboard(page);

  // Scenario 6: sign out, sign back in -> no Create Family
  await signOutFromApp(page);
  await signIn(page, email);
  await expectDashboard(page);

  // Scenario 8: existing owner never sees onboarding, even if visited directly
  await page.goto('/onboarding');
  await page.waitForTimeout(1500);
  await expect(page.getByRole('button', { name: /create family/i })).toHaveCount(0);

  // Scenario 9: no auth/routing/family-loading console errors
  const relevant = errors.filter(e => /auth|route|router|family|permission|firestore/i.test(e));
  expect(relevant, relevant.join('\n')).toEqual([]);
});
