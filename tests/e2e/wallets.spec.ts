import { test, expect } from '@playwright/test';
import { loginAs, logout } from './utils/auth';
import { execSync } from 'child_process';

test.describe('Child Wallets Screen', () => {
  test.beforeEach(async () => {
    execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
  });

  test('Owner can access wallets and add money', async ({ page }) => {
    await loginAs(page, 'owner@test.com');
    await page.click('a[href="/wallets"]');
    await expect(page.locator('text="Child Wallets"')).toBeVisible();

    // Verify we see child wallet
    await expect(page.locator('text="Child Leo"')).toBeVisible();
    await expect(page.locator('text="Balance"').first()).toBeVisible();

    // Open the Manage Wallet dialog for the first child (real current flow)
    await page.getByRole('button', { name: 'Manage Wallet' }).first().click();
    const dialog = page.getByTestId('manage-wallet-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Manage Child Leo's Wallet")).toBeVisible();

    // Add Money tab is the default; deposit 15.50 with a note
    await dialog.getByLabel('Amount (£)').fill('15.50');
    await dialog.getByLabel('Note (Optional)').fill('Allowance');
    await dialog.getByTestId('manage-wallet-submit').click();

    // Dialog closes and the ledger entry is reflected in Recent Activity
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('text="Added £15.50"').first()).toBeVisible();

    await logout(page);
  });

  test('Parent can access wallets and add money', async ({ page }) => {
    await loginAs(page, 'parent@test.com');
    await page.click('a[href="/wallets"]');
    await expect(page.locator('text="Child Wallets"')).toBeVisible();

    // Open the Manage Wallet dialog for the first child (real current flow)
    await page.getByRole('button', { name: 'Manage Wallet' }).first().click();
    const dialog = page.getByTestId('manage-wallet-dialog');
    await expect(dialog).toBeVisible();

    // Deposit 5.00
    await dialog.getByLabel('Amount (£)').fill('5.00');
    await dialog.getByTestId('manage-wallet-submit').click();

    // Dialog closes and the ledger entry is reflected in Recent Activity
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('text="Added £5.00"').first()).toBeVisible();

    await logout(page);
  });

  test('Child cannot access wallets screen', async ({ page }) => {
    await loginAs(page, 'child@test.com');
    // Ensure no link to wallets
    await expect(page.locator('a[href="/wallets"]')).not.toBeVisible();

    // Try forcing navigation
    await page.goto('/wallets');
    // Should be redirected to home or somewhere else
    await expect(page.locator('text="Child Wallets"')).not.toBeVisible();

    await logout(page);
  });
});
