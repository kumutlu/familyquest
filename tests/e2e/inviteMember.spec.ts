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

  const openInviteDialog = async (page: import('@playwright/test').Page, isOwner: boolean) => {
    const consoleErrors: string[] = [];
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`));

    const inviteButton = page.getByRole('button', { name: /invite member/i }).first();
    await expect(inviteButton).toBeVisible();
    await expect(inviteButton).toBeEnabled();

    await inviteButton.click();

    const dialog = page.getByRole('dialog', { name: /invite someone/i });
    await expect(dialog).toBeVisible();

    // Parents retain the child/manual entry points; only owners may create an
    // adult invitation.
    await expect(dialog.getByRole('heading', { name: 'Invite someone' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Child with their own device/ })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: /Create managed child/ })).toBeEnabled();
    if (isOwner) {
      await expect(dialog.getByRole('button', { name: /Another Parent/ })).toBeEnabled();
    } else {
      await expect(dialog.getByRole('button', { name: /Another Parent/ })).toHaveCount(0);
    }
    // No code, URL, share or copy affordance before a choice is made.
    await expect(dialog.locator('code')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Copy link' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Share invitation' })).toHaveCount(0);

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
    return dialog;
  };

  test('owner can open the invite dialog and reach a shareable parent invitation', async ({ page }) => {
    await loginAs(page, 'owner@test.com');
    await page.goto('/family');
    const dialog = await openInviteDialog(page, true);

    await dialog.getByRole('button', { name: /Another Parent/ }).click();

    await expect(dialog.getByRole('status')).toHaveText('Private invitation ready.');
    await expect(dialog.getByTestId('adult-invite-link')).toHaveAttribute('href', /\/invite\//);
    await expect(dialog.getByRole('button', { name: 'Share private invitation' })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: 'Copy private link' })).toBeEnabled();
  });

  test('a non-owner parent can open the invite dialog (regression for missing entry point)', async ({ page }) => {
    await loginAs(page, 'parent@test.com');
    await page.goto('/family');
    // The root cause: previously this button did not exist for a parent.
    await openInviteDialog(page, false);
  });
});
