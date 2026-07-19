// Phase 5 — Production smoke test for the Goals release (live project).
// Validates the Goals scenarios from the deployment plan against the
// LIVE familyquest-beta-402cb project using real test accounts:
//   parent: test-parent@familyquest.test / Test1234
//   child:  test-child@familyquest.test  / Test1234
//   family: smoke-test-family (tagged smokeTest:true)
// Uses only trivial amounts (no meaningful real money). All created
// documents live under family `smoke-test-family` and are deleted by
// scripts/cleanup-smoke.ts afterward.
//
// NOTE: This Playwright spec deliberately avoids the firebase-admin SDK
// (it triggers a jwks-rsa ESM cache error under Playwright's loader).
// Goal-creation persistence is verified separately via
// `npx tsx scripts/verify-smoke-data.ts` after the run.
//
// Run: npx playwright test --config playwright.prod.config.ts production-smoke.spec.ts
import { test, expect } from '@playwright/test';
import { loginAs } from './utils/auth-production';

const PARENT = 'test-parent@familyquest.test';
const CHILD = 'test-child@familyquest.test';
const PASS = 'Test1234';
// Fixed title. The cleanup script (scripts/cleanup-smoke-goals.ts) clears
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
    await loginAs(page, CHILD, PASS);
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
