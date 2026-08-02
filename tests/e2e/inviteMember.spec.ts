import { test, expect } from '@playwright/test';
import { loginAs } from './utils/auth';
import { execSync } from 'child_process';

/**
 * Runtime regression for the Family Hub "Invite Member" action.
 *
 * This runs in a real browser (not jsdom) so it catches failures that unit
 * tests cannot see: swallowed runtime errors, stacking/pointer-events issues,
 * and modals that mount but render nothing useful.
 *
 * The original bug: the Invite Member button was gated on `isOwnerRole`, so a
 * non-owner parent had NO invite entry point at all — the button literally did
 * not exist for them. The modal also rendered as a bare <div> with no
 * role="dialog", so automation/assistive tech could not perceive it.
 */
test.describe('Family Hub → Invite Member', () => {
  test.beforeEach(async () => {
    execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
  });

  const openInviteDialog = async (page: import('@playwright/test').Page) => {
    const consoleErrors: string[] = [];
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`));

    const inviteButton = page.getByRole('button', { name: /invite member/i }).first();
    await expect(inviteButton).toBeVisible();
    await expect(inviteButton).toBeEnabled();

    await inviteButton.click();

    const dialog = page.getByRole('dialog', { name: /invite member/i });
    await expect(dialog).toBeVisible();

    // The dialog must be actually usable, not an empty shell.
    const code = dialog.locator('code');
    await expect(code).toBeVisible();
    await expect(code).not.toHaveText('—');
    await expect(dialog.getByRole('button', { name: /copy/i })).toBeEnabled();

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  };

  test('owner can open the invite dialog and see a usable invite code', async ({ page }) => {
    await loginAs(page, 'owner@test.com');
    await page.goto('/family');
    await openInviteDialog(page);
  });

  test('a non-owner parent can open the invite dialog (regression for missing entry point)', async ({ page }) => {
    await loginAs(page, 'parent@test.com');
    await page.goto('/family');
    // The root cause: previously this button did not exist for a parent.
    await openInviteDialog(page);
  });
});
