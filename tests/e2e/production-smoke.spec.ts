// Phase 5 — Production smoke test for the Goals release (live project).
// Validates the Goals scenarios from the deployment plan against the
// LIVE deployment (https://queki.app → familyquest-beta-402cb project) using
// DISPOSABLE QA fixture accounts. Credentials are read from environment
// variables and are NEVER committed to source:
//   QUEKI_SMOKE_PARENT_EMAIL    / QUEKI_SMOKE_PARENT_PASSWORD
//   QUEKI_SMOKE_CHILD_EMAIL     / QUEKI_SMOKE_CHILD_PASSWORD
//   QUEKI_SMOKE_UNRELATED_EMAIL / QUEKI_SMOKE_UNRELATED_PASSWORD (optional)
//   family: disposable QA fixture family (tagged smokeTest:true)
// Uses only trivial amounts (no meaningful real money). All created
// documents live under the disposable fixture family and are deleted by
// scripts/cleanup-smoke.ts afterward.
//
// NOTE: This Playwright spec deliberately avoids the firebase-admin SDK
// (it triggers a jwks-rsa ESM cache error under Playwright's loader).
// Goal-creation persistence is verified separately via
// `npx tsx scripts/verify-smoke-data.ts` after the run.
//
// Run: npm run test:smoke   (see docs/production-smoke.md)
import { test, expect } from '@playwright/test';
import { loginAs } from './utils/auth-production';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `[production-smoke] Missing required environment variable ${name}. ` +
      `Provide disposable QA credentials via env vars / local secret storage ` +
      `(see docs/production-smoke.md). Never hard-code or commit credentials.`,
    );
  }
  return value;
}

const PARENT = requireEnv('QUEKI_SMOKE_PARENT_EMAIL');
const CHILD = requireEnv('QUEKI_SMOKE_CHILD_EMAIL');
const PASS = requireEnv('QUEKI_SMOKE_PARENT_PASSWORD');
const CHILD_PASS = process.env.QUEKI_SMOKE_CHILD_PASSWORD || PASS;
// Fixed title. The cleanup script (scripts/cleanup-smoke.ts) clears
// the goal-create idempotency doc before each run, so a re-run with the
// same title performs a real write (no idempotent-replay short-circuit).
const GOAL_TITLE = 'Smoke Goal 1';

test.describe('Goals production smoke (live project)', () => {
  test('S1 parent creates a family goal (atomic seed)', async ({ page }) => {
    test.setTimeout(60000);
    const errors: string[] = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

    await loginAs(page, PARENT, PASS);
    await page.goto('/goals');
    await expect(page.locator('text=Goals').first()).toBeVisible({ timeout: 10000 });

    await page.locator('button:has-text("New Goal")').click();
    await expect(page.locator('text=Create a Goal').first()).toBeVisible({ timeout: 5000 });
    await page.fill('input[placeholder="e.g. Family Holiday"]', GOAL_TITLE);
    // Create a CHILD goal assigned to the smoke child so the child account
    // can see and contribute to it (children do not see family goals).
    await page.locator('div[role="dialog"] button:has-text("Child")').click();
    await page.selectOption('div[role="dialog"] select', { label: 'Smoke Child' }).catch(() => {});
    await page.fill('div[role="dialog"] input[placeholder="0.00"]', '10');
    await page.locator('div[role="dialog"] button:has-text("None")').click().catch(() => {});
    await page.locator('button:has-text("Create Goal")').click();

    // Wait for either the modal to close (success) or an in-app error to appear.
    await page.waitForTimeout(5000);
    const modalGone = await page.locator('text=Create a Goal').count();
    const appErr = await page.locator('[role="alert"], .text-red-500, .error, text=/Could not|denied|permission|Error/i').first().textContent().catch(() => null);
    if (errors.length) console.log('S1 CONSOLE ERRORS:', JSON.stringify(errors.slice(0, 10), null, 2));
    if (appErr) console.log('S1 APP ERROR TEXT:', appErr);
    console.log('S1 modalGone(count of Create a Goal):', modalGone);
    await page.screenshot({ path: 'test-results/prod-goal-created.png', fullPage: true });
    // Assert the goal actually landed in Firestore via the standalone verify script
    // (run separately). Here we just confirm the modal closed without an error.
    expect(modalGone, 'modal should close after create (success path)').toBe(0);
    expect(appErr, 'no in-app error after create').toBeNull();
  });

  test('S2 child opens Contribute modal on a goal', async ({ page }) => {
    test.setTimeout(60000);
    await loginAs(page, CHILD, CHILD_PASS);
    await page.goto('/goals');
    await expect(page.locator('text=Goals').first()).toBeVisible({ timeout: 10000 });
    const goal = page.locator(`text=${GOAL_TITLE}`).first();
    await expect(goal).toBeVisible({ timeout: 15000 });
    await goal.click();
    await page.locator('button:has-text("Contribute")').click();
    await expect(page.locator(`text=Contribute to ${GOAL_TITLE}`).first()).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'test-results/prod-contribute-modal.png', fullPage: true });
  });

  test('S3 parent goal detail shows contribution breakdown', async ({ page }) => {
    test.setTimeout(60000);
    await loginAs(page, PARENT, PASS);
    await page.goto('/goals');
    await expect(page.locator('text=Goals').first()).toBeVisible({ timeout: 10000 });
    const goal = page.locator(`text=${GOAL_TITLE}`).first();
    await expect(goal).toBeVisible({ timeout: 15000 });
    await goal.click();
    await expect(page.locator('text=Contribution Breakdown').first()).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'test-results/prod-goal-detail.png', fullPage: true });
  });
});

const UNRELATED = process.env.QUEKI_SMOKE_UNRELATED_EMAIL || '';
const UNRELATED_PASS = process.env.QUEKI_SMOKE_UNRELATED_PASSWORD || PASS;

test.describe('Task Approval Production Smoke (Stage 2 Gamification)', () => {
  test('T1 Child can complete a task, but cannot approve it', async ({ page }) => {
    test.setTimeout(60000);
    await loginAs(page, CHILD, CHILD_PASS);
    await page.goto('/tasks');
    await expect(page.locator('text=Tasks').first()).toBeVisible({ timeout: 10000 });

    const task = page.locator('text="Clean Room (Smoke)"').first();
    await expect(task).toBeVisible({ timeout: 10000 });
    await task.click();

    // Mark as done
    const markDoneBtn = page.getByRole('button', { name: 'Mark as Done' });
    if (await markDoneBtn.isVisible()) {
      await markDoneBtn.click();
    }

    // Ensure child sees it's waiting, but NO approve button exists for child
    await expect(page.locator('text="Waiting for Approval"').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  });

  test('T2 Unrelated family parent cannot see or approve the task', async ({ page }) => {
    test.setTimeout(60000);
    test.skip(!UNRELATED, 'QUEKI_SMOKE_UNRELATED_EMAIL not set; isolation check skipped');
    await loginAs(page, UNRELATED, UNRELATED_PASS);
    await page.goto('/');

    // Dashboard should load, but no Approval Center items should appear
    await expect(page.locator('text="Dashboard"').first()).toBeVisible({ timeout: 10000 });

    // Ensure no pending task completions are shown
    await expect(page.locator('text="Task Completion"')).toHaveCount(0);
    await expect(page.locator('text="Clean Room (Smoke)"')).toHaveCount(0);
  });

  test('T3 Parent can reject a pending task', async ({ page }) => {
    test.setTimeout(60000);
    await loginAs(page, PARENT, PASS);
    await page.goto('/');

    // Find the task completion in Approval Center
    const rejectBtn = page.getByRole('button', { name: 'Reject' }).first();
    await expect(page.locator('text="Task Completion"').first()).toBeVisible({ timeout: 10000 });
    await expect(rejectBtn).toBeVisible();

    await rejectBtn.click();
    // It should disappear
    await expect(page.locator('text="Task Completion"')).not.toBeVisible({ timeout: 10000 });
  });

  test('T4 Parent can approve a pending task', async ({ page }) => {
    test.setTimeout(90000); // 90s because we have to complete it again
    // 1. Child marks it done again
    await loginAs(page, CHILD, CHILD_PASS);
    await page.goto('/tasks');
    const task = page.locator('text="Clean Room (Smoke)"').first();
    await expect(task).toBeVisible({ timeout: 10000 });
    await task.click();
    const markDoneBtn = page.getByRole('button', { name: 'Mark as Done' });
    if (await markDoneBtn.isVisible()) {
      await markDoneBtn.click();
    }
    await expect(page.locator('text="Waiting for Approval"').first()).toBeVisible({ timeout: 10000 });

    // 2. Parent approves it
    await loginAs(page, PARENT, PASS);
    await page.goto('/');
    const approveBtn = page.getByRole('button', { name: 'Approve' }).first();
    await expect(page.locator('text="Task Completion"').first()).toBeVisible({ timeout: 10000 });
    await expect(approveBtn).toBeVisible();

    // This button click uses the current client payload (no deprecated fields)
    await approveBtn.click();

    // Task completion should disappear (successfully processed)
    await expect(page.locator('text="Task Completion"')).not.toBeVisible({ timeout: 10000 });
  });
});
