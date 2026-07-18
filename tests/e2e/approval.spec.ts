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

  test('Money Request: parent accepts a pending_acceptance request (assigned bug fix)', async ({ page }) => {
    // Seed has mr-accept-parent: child1 -> parent1, status 'pending_acceptance'.
    // The parent (requested-from) must see "Accept" (not Approve) and pressing it
    // must NOT surface "You no longer have permission to manage this request."
    await loginAs(page, 'parent@test.com');
    // mr-accept-parent is the only card that renders an "Accept" button
    // (mr-pending renders Approve/Reject; mr-accept renders only Reject).
    const moneyCard = page.locator('div.cursor-pointer', { has: page.getByRole('button', { name: 'Accept' }) }).first();
    await expect(moneyCard).toBeVisible({ timeout: 5000 });
    // The assigned bug: this used to show Approve/Reject AND a permission-denied dead-end.
    await expect(page.locator('text=/permission-denied|You no longer have permission/i')).toHaveCount(0);
    // Accept is the actionable button for a pending_acceptance request where parent is requested-from.
    await expect(moneyCard.getByRole('button', { name: 'Accept' })).toBeVisible();
    await moneyCard.getByRole('button', { name: 'Accept' }).click();
    // After Accept, the request transitions to 'pending' and the Accept button is gone
    // (it now shows Approve/Reject like any other parent-approvable request).
    await expect(page.locator('div.cursor-pointer', { has: page.getByRole('button', { name: 'Accept' }) })).toHaveCount(0, { timeout: 10000 });
    await logout(page);
  });

  test('Money Request: parent rejects a pending_acceptance request (no permission-denied)', async ({ page }) => {
    // mr-accept: child2 -> child1, status 'pending_acceptance'. Parent can reject it.
    await loginAs(page, 'parent@test.com');
    const moneyCard = page.locator('div.cursor-pointer', { hasText: 'Child Ava requested' }).first();
    await expect(moneyCard).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=/permission-denied|You no longer have permission/i')).toHaveCount(0);
    await moneyCard.getByRole('button', { name: 'Reject' }).click();
    // Card leaves Pending immediately (optimistic removal).
    await expect(page.locator('text=/Child Ava requested/')).toHaveCount(0);
    // Open History and wait for the listener to reflect the rejected request.
    await page.getByRole('button', { name: 'History' }).click();
    // The rejected request now appears in History (resolved description + REJECTED badge).
    // The pending text "Child Ava requested" becomes "Child Leo accepted Child Ava's request…"
    // once resolved, so we assert on the child name + the REJECTED status badge.
    await expect(page.locator('div.cursor-pointer', { hasText: 'Child Ava' }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=REJECTED').first()).toBeVisible({ timeout: 10000 });
    await logout(page);
  });
});
