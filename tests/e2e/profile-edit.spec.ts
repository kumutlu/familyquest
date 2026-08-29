import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'child_process';
import { loginAs, logout } from './utils/auth';

test.describe('Child profile direct save', () => {
  test.beforeEach(async () => {
    execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
  });

  async function openEditor(page: Page) {
    await page.getByRole('button', { name: 'Profile menu' }).click();
    await page.getByRole('menuitem', { name: 'Edit Profile' }).click();
  }

  test('child saves a display name immediately without an approval request', async ({ page }) => {
    await loginAs(page, 'child@test.com');
    await openEditor(page);
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
    await expect(page.getByText(/parent approval/i)).toHaveCount(0);
    await page.getByLabel('Display Name').fill('Leo The Brave');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Profile updated' })).toBeVisible();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Leo The Brave').first()).toBeVisible();

    await logout(page);
    await loginAs(page, 'child@test.com');
    await expect(page.getByText('Leo The Brave').first()).toBeVisible();
    await logout(page);
    await loginAs(page, 'parent@test.com');
    await expect(page.getByText(/Profile Update/i)).toHaveCount(0);
  });

  test('child saves a starter avatar directly', async ({ page }) => {
    await loginAs(page, 'child@test.com');
    await openEditor(page);
    await page.getByRole('gridcell', { name: /Cosmo Cat/ }).first().click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Profile updated' })).toBeVisible();

    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 });
    await openEditor(page);
    await expect(page.getByRole('gridcell', { name: /Cosmo Cat/ }).first()).toHaveAttribute('aria-pressed', 'true');
  });
});
