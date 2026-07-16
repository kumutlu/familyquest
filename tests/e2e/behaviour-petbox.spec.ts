import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { loginAs, logout } from './utils/auth';

test.describe('Behaviour & Pet Box Flows', () => {
  test.beforeEach(async () => {
    execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
  });

  test('Log Positive and Negative Behaviour', async ({ page }) => {
    await loginAs(page, 'parent@test.com');

    // Open the behaviour logging modal via the Quick Action
    await page.getByRole('button', { name: 'Log Behaviour' }).click();
    await expect(page.getByText('Log Behaviour').first()).toBeVisible();

    // Positive Behaviour
    await page.getByRole('button', { name: 'Positive' }).click();
    await page.selectOption('select', { label: 'Child Leo' });
    await page.fill('input[placeholder*="Helped"]', 'Helped with groceries');
    await page.fill('input[type="number"]', '15');
    await page.getByRole('button', { name: 'Log Event' }).click();

    // Check Notifications for positive event
    await page.click('button[aria-label="Notifications"]');
    await expect(page.locator('text="Helped with groceries"')).toBeVisible();
    await page.click('button[aria-label="Notifications"]');

    // Negative Behaviour
    await page.click('a[href="/"]');
    await page.getByRole('button', { name: 'Log Behaviour' }).click();
    await page.getByRole('button', { name: 'Negative' }).click();
    await page.selectOption('select', { label: 'Child Leo' });
    await page.fill('input[placeholder*="Helped"]', 'Didn\'t listen');
    await page.fill('input[type="number"]', '10'); // Points penalty
    await page.getByRole('button', { name: 'Log Event' }).click();

    // Check Notifications for negative event
    await page.click('button[aria-label="Notifications"]');
    await expect(page.locator('text="Didn\'t listen"')).toBeVisible();
  });

  test('Pet Box Expense', async ({ page }) => {
    await loginAs(page, 'parent@test.com');

    // Go to Pet Box Dashboard
    await page.click('a[href="/pet-box"]');

    // Add Expense
    await page.getByRole('button', { name: 'Add Expense' }).click();
    await page.fill('input[placeholder*="Dry Cat Food"]', 'Dog Food');
    await page.fill('input[type="number"]', '12.50');
    await page.getByRole('button', { name: 'Save Expense' }).click();

    // The expense is recorded and shown in the Recent Expenses list
    await expect(page.locator('text=Dog Food').first()).toBeVisible();
    // The fund balance reflects the recorded expense (£100.00 - £12.50 = £87.50)
    await expect(page.locator('text="£87.50"').first()).toBeVisible();
  });
});
