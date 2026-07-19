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


  test('Parent contribution seeds a family goal (mobile Create Goal flow)', async ({ page }) => {
    // Mobile viewport: the form must keep focus and apply the parent seed.
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, 'owner@test.com');
    await page.goto('/goals');
    await page.click('button:has-text("New Goal")');
    await expect(page.locator('text="Create a Goal"')).toBeVisible({ timeout: 5000 });
    await page.fill('input[placeholder="e.g. Family Holiday"]', 'Seeded Holiday');
    // Target amount (first 0.00 placeholder).
    await page.fill('div[role="dialog"] input[placeholder="0.00"]', '100');
    // Select the mutually-exclusive "Fixed amount" parent-contribution mode.
    await page.click('div[role="dialog"] button:has-text("Fixed amount")');
    // Parent contribution fixed amount (now the second 0.00 placeholder, revealed by mode selection).
    const fixed = page.locator('div[role="dialog"] input[placeholder="0.00"]').nth(1);
    await fixed.fill('30');
    await expect(fixed).toHaveValue('30');
    await page.click('button:has-text("Create Goal")');
    await page.waitForTimeout(1500);
    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => 'NO_BODY');
    console.log('DEBUG BODY=', JSON.stringify(bodyText.slice(0, 600)));
    await expect(page.locator('text="Seeded Holiday"').first()).toBeVisible({ timeout: 8000 });
    // The goal should reflect the £30.00 parent seed as Saved.
    await page.click('text="Seeded Holiday"');
    await expect(page.locator('text=/£30\.00/').first()).toBeVisible({ timeout: 8000 });
    await logout(page);
  });
});
