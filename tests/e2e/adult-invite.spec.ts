import { expect, test } from '@playwright/test';

import {
  countFamiliesForE2E,
  createAdultInvitationForE2E,
  seedAdultInviteE2E,
} from './utils/adultInvite';

test.describe('adult invitation authentication journey', () => {
  test.beforeEach(async () => {
    await seedAdultInviteE2E();
  });

  test('owner-issued adult invitations use the canonical opaque route', async ({ page }) => {
    const invitation = await createAdultInvitationForE2E('parent');

    await page.goto(`/invite/${invitation.token}`);

    await expect(page.getByRole('heading', { name: 'Join a family' })).toBeVisible();
    await expect(page.getByText("You've been invited to join Test Family")).toBeVisible();
    await expect(page.getByRole('link', { name: 'Continue with email' })).toBeVisible();
  });

  test('email signup retains the invitation and joins without creation onboarding', async ({ page }) => {
    const invitation = await createAdultInvitationForE2E('parent');
    const familyCountBeforeAuth = await countFamiliesForE2E();
    const email = `adult-invite-${Date.now()}@example.com`;

    await page.goto(`/invite/${invitation.token}`);
    await page.getByRole('link', { name: 'Continue with email' }).click();
    await expect(page).toHaveURL(/\/signup\?next=/);
    await page.getByLabel(/display name/i).fill('E2E Parent');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill('password123');
    await page.getByRole('button', { name: /^sign up$/i }).click();

    await expect(page.getByRole('button', { name: /^join$/i })).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: /^join$/i }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 20000 });
    await expect(page.getByTestId('queki-bottom-nav')).toBeAttached({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: /create or join|set up your family/i })).toHaveCount(0);
    expect(await countFamiliesForE2E()).toBe(familyCountBeforeAuth);
  });

  test('refresh keeps the opaque invitation route before authentication', async ({ page }) => {
    const invitation = await createAdultInvitationForE2E('adult');

    await page.goto(`/invite/${invitation.token}`);
    await expect(page.getByRole('heading', { name: 'Join a family' })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/invite/${invitation.token}$`));
    await expect(page.getByRole('link', { name: 'Continue with email' })).toBeVisible();
  });
});
