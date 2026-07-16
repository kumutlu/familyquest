import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { loginAs } from './utils/auth';

test.describe('Owner Permissions Flow', () => {
  test.beforeEach(async () => {
    execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
  });

  test('Owner can access and modify settings', async ({ page }) => {
    await loginAs(page, 'owner@test.com');

    // Owner sees the parent dashboard with Quick Actions (incl. Manage Wallet)
    await expect(page.getByRole('button', { name: 'Manage Wallet' })).toBeVisible();

    // Owner can see family members including themselves and parents on Family page
    await page.click('a[href="/family"]');
    await expect(page.locator('text="Owner Mom"')).toBeVisible();
    await expect(page.locator('text="Parent Dad"')).toBeVisible();

    // Owner should be able to go to settings (located in the profile dropdown)
    await page.click('button[aria-label="Profile menu"]');
    await page.click('text="Settings"');
    await expect(page.locator('text="Settings"').first()).toBeVisible();

    // Owner should be able to see Family Code
    await expect(page.locator('text="TEST99"')).toBeVisible();

    // Verify owner can log behaviour without permission issues
    await page.click('a[href="/"]');
    await page.getByRole('button', { name: 'Log Behaviour' }).click();
    await page.getByRole('button', { name: 'Positive' }).click();
    await page.selectOption('select', { label: 'Child Leo' });
    await page.fill('input[placeholder*="Helped"]', 'Owner logged this');
    await page.fill('input[type="number"]', '5');
    await page.getByRole('button', { name: 'Log Event' }).click();

    // Success implies no permission denied error in the UI
    await page.click('button[aria-label="Notifications"]');
    await expect(page.locator('text="Owner logged this"')).toBeVisible();
  });
});
