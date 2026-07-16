import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { loginAs, logout } from './utils/auth';

test.describe('Approval Center Flows', () => {
  test.beforeEach(async () => {
    execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
  });

  test('Task Approval & Rejection', async ({ page, context }) => {
    // 1. Child marks task complete
    await loginAs(page, 'child@test.com');
    await page.click('a[href="/tasks"]');
    await page.click('text="Clean Room"');
    await page.getByRole('button', { name: 'Mark as Done' }).click();

    // The task card now shows the pending-approval badge once the modal closes.
    await expect(page.getByTestId('task-details-dialog')).not.toBeVisible();
    await expect(page.locator('text="Waiting for Approval"').first()).toBeVisible();
    await logout(page);

    // 2. Parent rejects task
    await loginAs(page, 'parent@test.com');
    // Approval Center surfaces the pending task completion
    await expect(page.locator('text="Task Completion"').first()).toBeVisible();
    await page.getByRole('button', { name: 'Reject' }).first().click();
    // The rejected item leaves the pending list
    await expect(page.locator('text="Task Completion"')).not.toBeVisible();
    await logout(page);

    // 3. Child marks task complete again
    await loginAs(page, 'child@test.com');
    await page.click('a[href="/tasks"]');
    await page.click('text="Clean Room"');
    await page.getByRole('button', { name: 'Mark as Done' }).click();
    await expect(page.getByTestId('task-details-dialog')).not.toBeVisible();
    await expect(page.locator('text="Waiting for Approval"').first()).toBeVisible();
    await logout(page);

    // 4. Parent approves task
    await loginAs(page, 'parent@test.com');
    await expect(page.locator('text="Task Completion"').first()).toBeVisible();
    await page.getByRole('button', { name: 'Approve' }).first().click();
    await expect(page.locator('text="Task Completion"')).not.toBeVisible();
  });

  test('Pet Box Approval', async ({ page }) => {
    // 1. Child donates
    await loginAs(page, 'child@test.com');
    await page.click('a[href="/pet-box"]');
    await page.getByRole('button', { name: '£5' }).click();
    // Confirmation dialog asks for parent approval
    await expect(page.getByText('You are asking to donate')).toBeVisible();
    await page.getByRole('button', { name: 'Request Donation' }).click();
    await expect(page.getByText('You are asking to donate')).not.toBeVisible();
    await logout(page);

    // 2. Parent approves the donation in the Approval Center
    await loginAs(page, 'parent@test.com');
    await expect(page.locator('text="Pet Box Donation"').first()).toBeVisible();
    await page.getByRole('button', { name: 'Approve' }).first().click();
    await expect(page.locator('text="Pet Box Donation"')).not.toBeVisible();

    // 3. The contribution is now reflected in the fund's donation list
    await page.click('a[href="/pet-box"]');
    await expect(page.locator('text="Child Leo"').first()).toBeVisible();
  });
});
