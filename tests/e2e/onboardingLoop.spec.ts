import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import { execSync } from 'child_process';
import { loginAs, logout } from './utils/auth';
import {
  completeEmailOnboarding,
  getOnboardingOutcome,
  expectDashboard,
  type OnboardingPersona,
} from './utils/onboardingFlow';
import { collectE2ETimeline, isFirestoreTransportError } from './utils/timeline';

/**
 * P0 verification: creating a family via the Refined Queki onboarding must not
 * bounce the parent back to the onboarding (Create Family) screen — the
 * redirect loop that previously existed on the legacy flow.
 *
 * The legacy assertions ("Create family" button, "Welcome to Queki") are
 * removed; this now exercises the approved S1–S7 → P1–P3 flow and asserts the
 * authoritative exactly-once outcome plus stable post-setup routing.
 */

const PASSWORD = 'password123';
let finishTimeline: ((testInfo: import('@playwright/test').TestInfo) => Promise<void>) | undefined;
test.beforeEach(async ({ page }) => { finishTimeline = collectE2ETimeline(page); });
test.afterEach(async ({}, testInfo) => finishTimeline?.(testInfo));

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

function persona(): OnboardingPersona {
  return {
    parent: 'Loop Parent',
    relationship: 'Parent',
    child: 'Loop Child',
    family: 'Loop Family',
    email: uniqueEmail('loop'),
    password: PASSWORD,
  };
}

test('parent creates a family once and lands on the dashboard without a loop', async ({ page }) => {
  const errors = collectErrors(page);
  const data = persona();

  await page.goto('/');
  await completeEmailOnboarding(page, data);

  // Scenario 3: dashboard opens immediately, no onboarding loop.
  await expectDashboard(page);

  // Authoritative exactly-once outcome.
  const outcome = await getOnboardingOutcome(data.email);
  expect(outcome.familyCount).toBe(1);
  expect(outcome.childCount).toBe(1);
  expect(outcome.taskCount).toBe(1);

  // Scenario 4/5: refresh stays on the dashboard (no re-onboarding).
  await page.reload();
  await expectDashboard(page);

  // Scenario 6: sign out, sign back in -> still the dashboard, never onboarding.
  await logout(page);
  await loginAs(page, data.email);
  await expectDashboard(page);
  await expect(page.getByRole('button', { name: /set up your family/i })).toHaveCount(0);

  // Scenario 8: an existing owner never sees onboarding, even via direct URL.
  await page.goto('/onboarding');
  await expect(page).not.toHaveURL(/\/onboarding/);
  await expect(page.getByRole('heading', { name: /small wins\. big habits\./i })).toHaveCount(0);

  // Scenario 9: no auth/routing/family-loading console errors.
  const relevant = errors.filter((e) => !isFirestoreTransportError(e) && /auth|route|router|family|permission|firestore/i.test(e));
  expect(relevant, relevant.join('\n')).toEqual([]);
});
