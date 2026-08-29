import { Page, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { expectOnboardingP1TerminalState } from './readiness';

/**
 * Shared helpers for the Refined Queki onboarding E2E contract.
 *
 * These drive the *approved* pre-auth (S1–S7) + post-auth (P1–P3) flow and read
 * the authoritative Firestore outcome so tests can assert exactly-once creation
 * of the family, the first managed child, and the first task.
 *
 * Requires the Firebase emulator suite (firestore + auth) — started by
 * `npm run test:e2e` / `firebase emulators:exec`.
 *
 * The authoritative outcome is read by a *standalone* `npx tsx` process
 * (`readOutcome.ts`) invoked via `execSync`, so the Admin SDK / `jwks-rsa`
 * dependency graph never enters the Playwright module loader (which cannot
 * resolve `jwe/compact/decrypt.js`). This mirrors the pattern used by
 * `seed.ts`.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const READ_OUTCOME_SCRIPT = join(__dirname, 'readOutcome.ts');

export interface OnboardingPersona {
  parent: string;
  relationship: string; // exact button label, e.g. 'Dad'
  child: string;
  family: string;
  email: string;
  password: string;
}

export type PreAuthStep = 's1' | 's2' | 's3' | 's4' | 's5' | 's6' | 's7';

export interface OnboardingOutcome {
  familyId: string | null;
  /** Families owned by this user (authoritative exactly-once check). */
  familyCount: number;
  /** Managed children (role === 'child') in the family. */
  childCount: number;
  /** Active tasks in the family. */
  taskCount: number;
}

const S1_HEADING = /small wins\. big habits\./i;
const S2_HEADING = /what should we call you/i;
const S3_HEADING = /and you're the/i;
const S4_HEADING = /let's make this yours/i;
const S5_HEADING = /here's how it works/i;
const S6_HEADING = /every family needs a name/i;
const S7_HEADING = /your family is ready/i;
const P1_HEADING = /your family is taking shape/i;
const P2_HEADING = /their first win/i;
const P3_HEADING = /first task is ready/i;

const CONTINUE = /^continue$/i;

/** Drive the pre-auth steps up to (and including the view of) `stopAt`. */
export async function driveToStep(page: Page, data: OnboardingPersona, stopAt: PreAuthStep = 's7') {
  await expect(page.getByRole('heading', { name: S1_HEADING })).toBeVisible({ timeout: 15000 });
  if (stopAt === 's1') return;

  await page.getByRole('button', { name: /set up your family/i }).click();
  await expect(page.getByRole('heading', { name: S2_HEADING })).toBeVisible();
  if (stopAt === 's2') return;

  await page.getByLabel(/your first name/i).fill(data.parent);
  await page.getByRole('button', { name: CONTINUE }).click();
  await expect(page.getByRole('heading', { name: S3_HEADING })).toBeVisible();
  if (stopAt === 's3') return;

  await page.getByRole('radio', { name: data.relationship, exact: true }).click();
  await page.getByRole('button', { name: CONTINUE }).click();
  await expect(page.getByRole('heading', { name: S4_HEADING })).toBeVisible();
  if (stopAt === 's4') return;

  await page.getByLabel(/child's first name/i).fill(data.child);
  await page.getByRole('button', { name: CONTINUE }).click();
  await expect(page.getByRole('heading', { name: S5_HEADING })).toBeVisible();
  if (stopAt === 's5') return;

  await page.getByRole('button', { name: /looks good/i }).click();
  await expect(page.getByRole('heading', { name: S6_HEADING })).toBeVisible();
  if (stopAt === 's6') return;

  await page.getByLabel(/family name/i).fill(data.family);
  await page.getByRole('button', { name: CONTINUE }).click();
  await expect(page.getByRole('heading', { name: S7_HEADING })).toBeVisible();
}

/** Complete S7 email signup, prove creation stays inert, then explicitly enter P1. */
export async function signUpFromS7(page: Page, data: OnboardingPersona) {
  await expect(page.getByRole('heading', { name: S7_HEADING })).toBeVisible();
  await page.getByRole('button', { name: /continue with email/i }).click();

  await expect(page).toHaveURL(/\/signup/, { timeout: 15000 });
  // The Signup form labels are not htmlFor/id-associated, so select by input type.
  await page.locator('input[type="text"]').fill(data.parent);
  await page.locator('input[type="email"]').fill(data.email);
  await page.locator('input[type="password"]').fill(data.password);
  await page.getByRole('button', { name: /sign up/i }).click();

  // Authentication alone may not authorize family creation. The no-family
  // choice must render first, with both explicit affordances available.
  await expect(page).toHaveURL(/\/no-family$/, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Create a family' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Join an existing family' })).toBeVisible();
  const before = await getOnboardingOutcome(data.email, { familyCount: 0, childCount: 0, taskCount: 0 });
  expect(before.familyCount, 'signup must not create a family').toBe(0);
  expect(before.childCount, 'signup must not create a child').toBe(0);
  expect(before.taskCount, 'signup must not create a task').toBe(0);

  await page.getByRole('button', { name: 'Create a family' }).click();
  await expect(page).toHaveURL(/\/onboarding\?mode=create$/, { timeout: 20_000 });

  // The explicit create intent authorizes the preserved S7 draft to advance.
  await expectOnboardingP1TerminalState(page);
}

/** Drive P1 -> P2 -> P3 -> dashboard. */
export async function completePostAuth(page: Page, data: OnboardingPersona) {
  // P1 auto-creates the family + first child; wait for the Continue control.
  await expect(page.getByRole('button', { name: CONTINUE })).toBeEnabled({ timeout: 20000 });
  await page.getByRole('button', { name: CONTINUE }).click();

  // P2 — pick a starter task.
  await expect(page.getByRole('heading', { name: P2_HEADING })).toBeVisible();
  await page.getByRole('radio', { name: /tidy bedroom/i }).click();
  await page.getByRole('button', { name: /add task & continue/i }).click();

  // P3 — success.
  await expect(page.getByRole('heading', { name: P3_HEADING })).toBeVisible();
  await page.getByRole('button', { name: /go to my dashboard/i }).click();

  await expect(page).toHaveURL(/\/$|\/#?$/, { timeout: 15000 });
}

/** Full email onboarding: S1..S7 -> signup -> P1..P3 -> dashboard. */
export async function completeEmailOnboarding(page: Page, data: OnboardingPersona) {
  await driveToStep(page, data, 's7');
  await signUpFromS7(page, data);
  await completePostAuth(page, data);
}

/** Read the authoritative Firestore outcome for a just-onboarded user. */
export async function getOnboardingOutcome(
  email: string,
  expected: Partial<OnboardingOutcome> = { familyCount: 1, childCount: 1, taskCount: 1 },
): Promise<OnboardingOutcome> {
  const raw = execSync(`npx tsx "${READ_OUTCOME_SCRIPT}"`, {
    encoding: 'utf8',
    env: { ...process.env, ONBOARDING_EMAIL: email, ONBOARDING_EXPECTED_OUTCOME: JSON.stringify(expected) },
    timeout: 60_000,
  });
  const trimmed = raw.trim();
  const parsed = trimmed ? JSON.parse(trimmed) : {};
  return {
    familyId: parsed.familyId ?? null,
    familyCount: parsed.familyCount ?? 0,
    childCount: parsed.childCount ?? 0,
    taskCount: parsed.taskCount ?? 0,
  };
}

/** Assert the dashboard is shown (not onboarding) and the app chrome is present. */
export async function expectDashboard(page: Page) {
  await expect(page).toHaveURL(/\/$|\/#?$/);
  await expect(page.getByRole('heading', { name: S1_HEADING })).toHaveCount(0);
  // The bottom nav is `md:hidden` (desktop hides it), so assert attachment rather
  // than visibility — its presence confirms AppLayout (not onboarding) rendered.
  await expect(page.locator('[data-testid="queki-bottom-nav"], [data-testid="mobile-bottom-nav"]')).toBeAttached({ timeout: 15000 });
}
