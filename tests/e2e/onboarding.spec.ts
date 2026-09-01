import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import { execSync } from 'child_process';
import { loginAs, logout } from './utils/auth';
import {
  driveToStep,
  signUpFromS7,
  completePostAuth,
  completeEmailOnboarding,
  getOnboardingOutcome,
  expectDashboard,
  type OnboardingPersona,
} from './utils/onboardingFlow';
import { collectE2ETimeline, isFirestoreTransportError } from './utils/timeline';

/**
 * Refined Queki onboarding — E2E contract.
 *
 * These tests assert the *approved* pre-auth (S1–S7) + post-auth (P1–P3) flow.
 * They replace the legacy "Create family" / "Welcome to Queki" / "Step 2 of 3"
 * assertions that belonged to the deleted legacy onboarding. The tests are
 * strengthened (not weakened): they assert the authoritative Firestore outcome
 * — exactly one family, managed child + wallet, first task + setup feed record
 * — and exercise refresh/recovery at meaningful boundaries.
 */

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`;
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

function persona(overrides: Partial<OnboardingPersona> = {}): OnboardingPersona {
  return {
    parent: 'Kemal',
    relationship: 'Dad',
    child: 'Osman',
    family: 'Umutlu Family',
    email: uniqueEmail('onboard'),
    password: 'password123',
    ...overrides,
  };
}

test.describe('Refined Queki onboarding', () => {
  let finishTimeline: ((testInfo: import('@playwright/test').TestInfo) => Promise<void>) | undefined;
  test.beforeEach(async ({ page }) => {
    finishTimeline = collectE2ETimeline(page);
    execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
  });
  test.afterEach(async ({}, testInfo) => finishTimeline?.(testInfo));

  test('New visitor lands on Refined Step 1 with the value proposition', async ({ page }) => {
    await page.goto('/');
    const heading = page.getByRole('heading', { name: /small wins\. big habits\./i });
    await expect(heading).toBeVisible({ timeout: 15000 });
    // The legacy "Welcome to Queki" copy must not appear.
    await expect(page.getByText(/welcome to queki/i)).toHaveCount(0);
    // Primary CTA + returning-user escape are present.
    await expect(page.getByRole('button', { name: /set up your family/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /i already have an account/i })).toBeVisible();
  });

  test('Returning user escapes Step 1 to the existing login UI', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /small wins\. big habits\./i })).toBeVisible();
    await page.getByRole('button', { name: /i already have an account/i }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test('Complete email onboarding creates exactly one family, child, and task', async ({ page }) => {
    const data = persona();
    await page.goto('/');
    await completeEmailOnboarding(page, data);

    const outcome = await getOnboardingOutcome(data.email);
    expect(outcome.familyId, 'familyId should be set').toBeTruthy();
    expect(outcome.familyCount, 'exactly one family').toBe(1);
    expect(outcome.childCount, 'exactly one first managed child').toBe(1);
    expect(outcome.walletCount, 'exactly one first managed-child wallet').toBe(1);
    expect(outcome.taskCount, 'exactly one first task').toBe(1);
    expect(outcome.feedCount, 'exactly one first-task setup feed record').toBe(1);
  });

  test('A legitimate second child remains distinct while initial setup effects stay singular', async ({ page }) => {
    const data = persona({ email: uniqueEmail('onboard-two-children') });
    await page.goto('/');
    await driveToStep(page, data, 's7');
    await signUpFromS7(page, data);

    await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Add another child' }).click();
    const addChildForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add another child' }) });
    await addChildForm.locator('input').fill('Second Child');
    await addChildForm.getByRole('button', { name: 'Add another child' }).click();
    await expect(page.getByText('Second Child')).toBeVisible();

    await completePostAuth(page, data);
    const outcome = await getOnboardingOutcome(data.email, {
      familyCount: 1,
      childCount: 2,
      walletCount: 2,
      taskCount: 1,
      feedCount: 1,
    });
    expect(outcome).toMatchObject({
      familyCount: 1,
      childCount: 2,
      walletCount: 2,
      taskCount: 1,
      feedCount: 1,
    });
  });

  test('Refresh during pre-auth preserves the draft and resumes at the same step', async ({ page }) => {
    const data = persona();
    await page.goto('/');
    // Drive to S4 and enter the child name, then refresh before continuing.
    await driveToStep(page, data, 's4');
    // Enter the child name at S4, then refresh before continuing.
    await page.getByLabel(/child's first name/i).fill(data.child);
    await expect(page.getByLabel(/child's first name/i)).toHaveValue(data.child);

    // The draft save is an async effect; wait for it to be durably persisted
    // (sessionStorage/localStorage mirror) before refreshing so the reload
    // cannot race the write.
    await page.waitForFunction(
      (child: string) => {
        const raw =
          sessionStorage.getItem('queki.onboardingDraft') ||
          localStorage.getItem('queki.onboardingDraft');
        if (!raw) return false;
        try {
          return (JSON.parse(raw) as { childFirstName?: string }).childFirstName === child;
        } catch {
          return false;
        }
      },
      data.child,
      { timeout: 5000 },
    );

    await page.reload();
    // Draft survives: still on S4 with the entered value intact.
    await expect(page.getByRole('heading', { name: /let's make this yours/i })).toBeVisible();
    await expect(page.getByLabel(/child's first name/i)).toHaveValue(data.child);

    // Continue from the restored S4 (draft already holds parent/relationship/child)
    // through to S7, then complete the post-auth setup.
    await page.getByRole('button', { name: /^continue$/i }).click();
    await expect(page.getByRole('heading', { name: /here's how it works/i })).toBeVisible();
    await page.getByRole('button', { name: /looks good/i }).click();
    await expect(page.getByRole('heading', { name: /every family needs a name/i })).toBeVisible();
    await page.getByLabel(/family name/i).fill(data.family);
    await page.getByRole('button', { name: /^continue$/i }).click();
    await expect(page.getByRole('heading', { name: /your family is ready/i })).toBeVisible();

    await signUpFromS7(page, data);
    await completePostAuth(page, data);

    const outcome = await getOnboardingOutcome(data.email);
    expect(outcome.familyCount).toBe(1);
    expect(outcome.childCount).toBe(1);
    expect(outcome.taskCount).toBe(1);
  });

  test('Refresh immediately after auth return (P1) does not duplicate the family', async ({ page }) => {
    const data = persona();
    await page.goto('/');
    await driveToStep(page, data, 's7');
    await signUpFromS7(page, data);

    // Refresh the moment P1 appears (before/at family creation).
    await page.reload();
    await expect(page.getByRole('heading', { name: /your family is taking shape/i })).toBeVisible({
      timeout: 20000,
    });

    await completePostAuth(page, data);

    const outcome = await getOnboardingOutcome(data.email);
    expect(outcome.familyCount, 'no duplicate family after P1 refresh').toBe(1);
    expect(outcome.childCount).toBe(1);
    expect(outcome.taskCount).toBe(1);
  });

  test('Refresh after family creation (before completion) resumes without duplicates', async ({ page }) => {
    const data = persona();
    await page.goto('/');
    await driveToStep(page, data, 's7');
    await signUpFromS7(page, data);

    // Wait for P1 to create the family + child, then refresh before finishing.
    await expect(page.getByRole('button', { name: /^continue$/i })).toBeEnabled({ timeout: 20000 });
    await page.reload();
    await expect(page.getByRole('heading', { name: /your family is taking shape/i })).toBeVisible({
      timeout: 20000,
    });

    // Authoritative state already exists — no second family/child.
    const mid = await getOnboardingOutcome(data.email, { familyCount: 1, childCount: 1 });
    expect(mid.familyCount).toBe(1);
    expect(mid.childCount).toBe(1);

    await completePostAuth(page, data);

    const outcome = await getOnboardingOutcome(data.email);
    expect(outcome.familyCount).toBe(1);
    expect(outcome.childCount).toBe(1);
    expect(outcome.taskCount).toBe(1);
  });

  test('Existing family owner never sees onboarding', async ({ page }) => {
    await loginAs(page, 'owner@test.com');

    // Bare root is the application, not onboarding.
    await page.goto('/');
    await expectDashboard(page);

    // Direct deep link to /onboarding is redirected away.
    await page.goto('/onboarding');
    await expect(page).not.toHaveURL(/\/onboarding/);
    await expect(page.getByRole('heading', { name: /small wins\. big habits\./i })).toHaveCount(0);
  });

  test('Managed child never enters parent onboarding', async ({ page }) => {
    await loginAs(page, 'child@test.com');
    await page.goto('/onboarding');
    await expect(page).not.toHaveURL(/\/onboarding/);
    await expect(page.getByRole('heading', { name: /small wins\. big habits\./i })).toHaveCount(0);
    // The child reaches their own authenticated experience.
    await expect(page.locator('[data-testid="queki-bottom-nav"], [data-testid="mobile-bottom-nav"]')).toBeAttached();
  });

  test('Owner signs out and back in without re-onboarding', async ({ page }) => {
    await loginAs(page, 'owner@test.com');
    await expectDashboard(page);

    await logout(page);
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });

    await loginAs(page, 'owner@test.com');
    await expectDashboard(page);
    await expect(page.getByRole('button', { name: /set up your family/i })).toHaveCount(0);
  });

  test('Protected deep link routes a signed-out user to login, not onboarding', async ({ page }) => {
    await page.goto('/wallet');
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: /small wins\. big habits\./i })).toHaveCount(0);
  });

  test('No auth/routing/family console errors during a full onboarding run', async ({ page }) => {
    const errors = collectErrors(page);
    const data = persona();
    await page.goto('/');
    await completeEmailOnboarding(page, data);

    const relevant = errors.filter((e) =>
      !isFirestoreTransportError(e) && /auth|route|router|family|permission|firestore|user not found/i.test(e),
    );
    expect(relevant, relevant.join('\n')).toEqual([]);
  });
});
