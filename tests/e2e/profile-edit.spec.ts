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

  // Current contract (0df6761 identity-only split + b7c7fd5 immediate avatar
  // persistence): a child's AVATAR selection is saved immediately via
  // updateChildAppearance, while a DISPLAY-NAME change always flows through
  // submitProfileUpdateRequest and the parent Approval Center.
  test('child submits a display-name change for parent approval', async ({ page }) => {
    await loginAs(page, 'child@test.com');
    await openEditor(page);

    // Name-only edit → the approval path button is shown.
    const submitButton = page.getByRole('button', { name: 'Submit for approval' });
    await expect(submitButton).toBeVisible();

    await page.getByLabel('Display Name').fill('Leo The Brave');
    await submitButton.click();
    await expect(page.getByRole('status').filter({ hasText: 'submitted for parent approval' })).toBeVisible();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 });

    // Identity is NOT applied immediately — the profile still shows the old name.
    await expect(page.getByText('Leo The Brave')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Child Leo' })).toBeVisible();

    // The parent now has a pending Profile Update Request in the Approval Center.
    await logout(page);
    await loginAs(page, 'parent@test.com');
    await page.getByTestId('approval-history-link').click();
    await expect(page.getByText('Profile Update Request').first()).toBeVisible({ timeout: 10_000 });
  });

  test('child saves a starter avatar directly (no approval request)', async ({ page }) => {
    await loginAs(page, 'child@test.com');
    await openEditor(page);

    await page.getByRole('gridcell', { name: /Cosmo Cat/ }).first().click();
    // Avatar-only change persists immediately — the button flips to Save.
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Profile updated' })).toBeVisible();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 });

    await openEditor(page);
    await expect(page.getByRole('gridcell', { name: /Cosmo Cat/ }).first()).toHaveAttribute('aria-pressed', 'true');

    await logout(page);

    // Appearance self-service creates NO approval request for the parent.
    await loginAs(page, 'parent@test.com');
    await page.getByTestId('approval-history-link').click();
    await expect(page.getByText('Profile Update Request')).toHaveCount(0);
  });
});
