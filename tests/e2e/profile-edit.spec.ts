import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'child_process';
import { loginAs, logout } from './utils/auth';

/**
 * End-to-end coverage for the child profile-edit approval flow.
 *
 * The "Edit Profile" entry point is the profile dropdown menu (avatar button in
 * the header), which opens the ProfileEditorModal directly. The parent Approval
 * Center is rendered on the parent dashboard (no dedicated /approvals route).
 *
 * The seeded child (child@test.com / "Child Leo") has NO avatarId, so a
 * display-name-only edit reproduces the production bug payload
 * (requestedAvatarId: null).
 */
test.describe('Child Profile Edit → Parent Approval', () => {
  test.beforeEach(async () => {
    execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
  });

  // Open the profile dropdown and click "Edit Profile" to launch the modal.
  async function openEditor(page: Page) {
    await page.getByRole('button', { name: 'Profile menu' }).click();
    await page.getByRole('menuitem', { name: 'Edit Profile' }).click();
  }

  // After a successful child submit the modal auto-closes (onClose after 1.4s).
  // We assert the editor closed AND no generic error is shown.
  async function expectSubmitSuccess(page: Page) {
    await expect(page.getByRole('button', { name: 'Submit for approval' })).not.toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/couldn'?t submit|try again/i)).toHaveCount(0);
  }

  test('child edits display name, parent approves, profile updates', async ({ page }) => {
    // 1. Child opens Edit Profile and changes display name only.
    await loginAs(page, 'child@test.com');
    await openEditor(page);
    const nameInput = page.getByLabel('Display Name');
    await nameInput.fill('Leo The Brave');
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await expectSubmitSuccess(page);
    await logout(page);

    // 2. Parent sees the pending profile update in the Approval Center (dashboard).
    await loginAs(page, 'parent@test.com');
    await expect(page.getByText(/Profile Update/i).first()).toBeVisible();
    await expect(page.getByText(/Leo The Brave/i).first()).toBeVisible();

    // 3. Parent approves.
    await page.getByRole('button', { name: 'Approve' }).first().click();
    await expect(page.getByText(/Profile Update/i)).not.toBeVisible();
    await logout(page);

    // 4. Child's profile now reflects the new name (visible on the dashboard header / family).
    await loginAs(page, 'child@test.com');
    await expect(page.getByText('Leo The Brave').first()).toBeVisible();
  });

  test('second profile request while one is pending is rejected', async ({ page }) => {
    await loginAs(page, 'child@test.com');
    await openEditor(page);
    const nameInput = page.getByLabel('Display Name');
    await nameInput.fill('Leo First');
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await expectSubmitSuccess(page);

    // Reopen editor — it should be locked (pending request exists).
    await openEditor(page);
    await expect(page.getByText(/awaiting parent approval/i)).toBeVisible();
    await expect(page.getByLabel('Display Name')).toBeDisabled();
  });

  test('avatar-only change flows through approval (no generic error)', async ({ page }) => {
    await loginAs(page, 'child@test.com');
    await openEditor(page);
    // Pick a starter avatar from the picker (gridcell with a starter-tier label).
    const starter = page.getByRole('gridcell', { name: /Cosmo Cat/ }).first();
    await starter.click();
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await expectSubmitSuccess(page);
    await logout(page);

    await loginAs(page, 'parent@test.com');
    await expect(page.getByText(/Profile Update/i).first()).toBeVisible();
    await page.getByRole('button', { name: 'Approve' }).first().click();
    await expect(page.getByText(/Profile Update/i)).not.toBeVisible();
  });

  test('rejected profile change does not apply', async ({ page }) => {
    await loginAs(page, 'child@test.com');
    await openEditor(page);
    const nameInput = page.getByLabel('Display Name');
    await nameInput.fill('Leo Rejected');
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await expectSubmitSuccess(page);
    await logout(page);

    await loginAs(page, 'parent@test.com');
    await expect(page.getByText(/Profile Update/i).first()).toBeVisible();
    await page.getByRole('button', { name: 'Reject' }).first().click();
    await expect(page.getByText(/Profile Update/i)).not.toBeVisible();
    await logout(page);

    // The rejected name must NOT be applied.
    await loginAs(page, 'child@test.com');
    await expect(page.getByText('Leo Rejected')).toHaveCount(0);
    await expect(page.getByText('Child Leo').first()).toBeVisible();
  });
});
