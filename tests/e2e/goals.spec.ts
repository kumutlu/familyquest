import { test, expect } from '@playwright/test';
import { loginAs, logout } from './utils/auth';
import { execSync } from 'child_process';

test.describe('Goals (Phase 3) UI', () => {
  test.beforeEach(async () => {
    execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
  });

  test('Goals list shows family and child goals', async ({ page }) => {
    await loginAs(page, 'owner@test.com');
    await page.click('a[href="/goals"]');
    await expect(page.locator('text="Goals"').first()).toBeVisible();
    await expect(page.locator('text="Family Holiday"')).toBeVisible();
    await expect(page.locator('text="Leo’s Bike"')).toBeVisible();
    await page.screenshot({ path: 'test-results/goals-list.png', fullPage: true });
    await logout(page);
  });

  test('Goal detail shows contribution breakdown from ledger', async ({ page }) => {
    await loginAs(page, 'owner@test.com');
    await page.click('a[href="/goals"]');
    await page.click('text="Leo’s Bike"');
    await expect(page.locator('text="Contribution Breakdown"')).toBeVisible();
    await expect(page.locator('text="Child savings"')).toBeVisible();
    await expect(page.locator('text="Auto matches"')).toBeVisible();
    await expect(page.locator('text=/Reached/')).toBeVisible();
    await page.screenshot({ path: 'test-results/goal-detail.png', fullPage: true });
    await logout(page);
  });

  test('Child can open the contribute modal', async ({ page }) => {
    await loginAs(page, 'child@test.com');
    await page.click('a[href="/goals"]');
    await page.click('text="Leo’s Bike"');
    await page.click('text="Contribute"');
    await expect(page.locator('text="Contribute to Leo’s Bike"')).toBeVisible();
    await page.screenshot({ path: 'test-results/goal-contribute-modal.png', fullPage: true });
    await logout(page);
  });

  test('Approval Center surfaces the goal withdrawal request', async ({ page }) => {
    await loginAs(page, 'owner@test.com');
    // Approval Center is rendered on the parent home dashboard.
    await expect(page.locator('text="Goal Withdrawal"').first()).toBeVisible({ timeout: 8000 });
    await page.screenshot({ path: 'test-results/approval-center-goals.png', fullPage: true });
    await logout(page);
  });
});
