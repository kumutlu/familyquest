import { expect, test } from '@playwright/test';

import {
  countFamiliesForE2E,
  createExpiredAdultInvitationForE2E,
  createNoFamilyUserForE2E,
  createRevokedAdultInvitationForE2E,
  createSameFamilyAdultInvitationForE2E,
  createAdultInvitationForE2E,
  createUsedAdultInvitationForE2E,
  seedAdultInviteE2E,
} from './utils/adultInvite';
import { loginAs } from './utils/auth';

async function loginFromInvite(page: import('@playwright/test').Page, email: string) {
  await page.getByRole('link', { name: /sign in with email/i }).click();
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill('password123');
  await page.getByRole('button', { name: /^sign in$/i }).click();
}

async function expectAdultInviteTerminal(page: import('@playwright/test').Page, token: string, copy: RegExp) {
  await page.goto(`/invite/${token}`);
  await expect(page.getByRole('heading', { name: 'Join a family' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(copy);
  await expect(page.getByRole('link', { name: /continue with email/i })).toHaveCount(0);
}

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

  test('Settings exposes the owner adult-invitation UI and Family Hub uses the same v2 callable', async ({ page }) => {
    await loginAs(page, 'owner@test.com');
    await page.goto('/settings?familySection=members');
    await page.getByRole('button', { name: /add parent or adult/i }).click();
    const settingsCard = page.getByTestId('adult-invite-card');
    await expect(settingsCard).toBeVisible();
    await expect(settingsCard.getByRole('button', { name: /create private invitation/i })).toBeEnabled();

    await page.goto('/family');
    await page.getByRole('button', { name: /invite member/i }).click();
    const familyHub = page.getByRole('dialog', { name: /invite someone/i });
    await familyHub.getByRole('button', { name: /another parent/i }).click();
    await expect(familyHub.getByText(/parent invitation ready/i)).toBeVisible();
    await expect(familyHub.getByRole('button', { name: /share invitation/i })).toBeEnabled();
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

    await expect(page.getByRole('button', { name: /join family/i })).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: /join family/i }).click();
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

  test('popup-equivalent auth handoff retains the v2 invitation intent', async ({ page }) => {
    const invitation = await createAdultInvitationForE2E();
    await page.goto(`/invite/${invitation.token}`);
    await page.getByRole('link', { name: /sign in with email/i }).click();
    await expect(page).toHaveURL(/\/login\?next=/);
    await expect.poll(() => page.evaluate(() => {
      const raw = localStorage.getItem('queki.pendingAdultInvite.v2');
      return raw ? JSON.parse(raw).token : null;
    })).toBe(invitation.token);
  });

  test('mobile redirect-equivalent auth handoff restores the invitation route', async ({ page }) => {
    const invitation = await createAdultInvitationForE2E();
    await page.goto(`/invite/${invitation.token}`);
    await loginFromInvite(page, 'owner@test.com');
    await expect(page).toHaveURL(new RegExp(`/invite/${invitation.token}$`));
    await expect(page.getByRole('button', { name: /join family/i })).toBeVisible();
  });

  test('authenticated refresh retains preview and excludes creation onboarding', async ({ page }) => {
    const invitation = await createSameFamilyAdultInvitationForE2E();
    await page.goto(`/invite/${invitation.token}`);
    await loginFromInvite(page, 'parent@test.com');
    await expect(page.getByRole('button', { name: /join family/i })).toBeVisible({ timeout: 20000 });
    await page.reload();
    await expect(page.getByRole('button', { name: /join family/i })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('heading', { name: /create or join|set up your family/i })).toHaveCount(0);
  });

  test('Signup to Login preserves an existing-account invitation', async ({ page }) => {
    const invitation = await createAdultInvitationForE2E();
    await page.goto(`/invite/${invitation.token}`);
    await page.getByRole('link', { name: /continue with email/i }).click();
    await expect(page).toHaveURL(/\/signup\?next=/);
    await page.getByRole('link', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByLabel(/email/i).fill('owner@test.com');
    await page.getByLabel(/password/i).fill('password123');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page).toHaveURL(new RegExp(`/invite/${invitation.token}$`));
    await expect(page.getByRole('button', { name: /join family/i })).toBeVisible({ timeout: 20000 });
  });

  test('same-family invitation is harmless and other-family invitation is a conflict', async ({ page }) => {
    const sameFamily = await createSameFamilyAdultInvitationForE2E();
    await page.goto(`/invite/${sameFamily.token}`);
    await loginFromInvite(page, 'parent@test.com');
    await expect(page.getByRole('button', { name: /join family/i })).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: /join family/i }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 20000 });
    await expect(page.getByTestId('queki-bottom-nav')).toBeAttached({ timeout: 20000 });

    const otherFamily = await createAdultInvitationForE2E();
    await page.goto(`/invite/${otherFamily.token}`);
    await loginFromInvite(page, 'other@test.com');
    await expect(page.getByRole('alert')).toContainText(/already belong to another family/i, { timeout: 20000 });
  });

  test('expired, revoked, and used invitations render terminal states', async ({ page }) => {
    const expired = await createExpiredAdultInvitationForE2E();
    await expectAdultInviteTerminal(page, expired.token, /expired/i);
    const revoked = await createRevokedAdultInvitationForE2E();
    await expectAdultInviteTerminal(page, revoked.token, /no longer active/i);
    const used = await createUsedAdultInvitationForE2E();
    await expectAdultInviteTerminal(page, used.token, /already been used/i);
  });

  test('no-invite users see Create/Join choice and stale drafts stay inert until Create', async ({ page }) => {
    const user = await createNoFamilyUserForE2E();
    const before = await countFamiliesForE2E();
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(user.email);
    await page.getByLabel(/password/i).fill(user.password);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page).toHaveURL(/\/no-family$/, { timeout: 20000 });
    await page.evaluate(() => localStorage.setItem('queki.onboardingDraft', JSON.stringify({ familyId: 'stale', childId: 'stale', step: 'p1' })));
    await page.reload();
    await expect(page.getByRole('button', { name: 'Create a family' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join a family' })).toBeVisible();
    expect(await countFamiliesForE2E()).toBe(before);
    await page.getByRole('button', { name: 'Create a family' }).click();
    await expect(page).toHaveURL(/\/onboarding\?mode=create$/);
    expect(await countFamiliesForE2E()).toBe(before);
  });

  test('Google-equivalent authenticated success creates zero family documents', async ({ page }) => {
    const user = await createNoFamilyUserForE2E();
    const before = await countFamiliesForE2E();
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(user.email);
    await page.getByLabel(/password/i).fill(user.password);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page).toHaveURL(/\/no-family$/, { timeout: 20000 });
    expect(await countFamiliesForE2E()).toBe(before);
  });
});
