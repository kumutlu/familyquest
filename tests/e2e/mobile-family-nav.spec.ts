// ---------------------------------------------------------------------------
// PERMANENT MOBILE REGRESSION SUITE
// ---------------------------------------------------------------------------
//
// Covers the three mobile fixes:
//
//   A. "Reset password" tap isolation on a managed-child card (must not
//      navigate to /family/{childId}).
//   B. "Delete child" tap isolation + the confirmation dialog being portalled
//      to document.body (never clipped by the member card, always above the
//      bottom navigation) and de-duplicated against double taps.
//   C. A single mobile bottom navigation, fixed to the viewport bottom on every
//      main route, at both scroll-top and scroll-bottom.
//
// All interactions use real touch taps (the projects in
// playwright.mobile.config.ts enable `hasTouch`/`isMobile`).
//
// Data safety: every record used here is created by tests/e2e/utils/seed-mobile.ts
// inside the Firebase emulators. The deletion test only ever targets the
// disposable seeded child "Disposable Dan".
// ---------------------------------------------------------------------------

import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'child_process';
import { loginAs } from './utils/auth';

const KEEP_CHILD_ID = 'child-managed-keep';
const KEEP_CHILD_NAME = 'Managed Mia';
const DISPOSABLE_CHILD_ID = 'child-managed-dispose';
const DISPOSABLE_CHILD_NAME = 'Disposable Dan';

const SHOTS = 'test-results/mobile';

function seed() {
  execSync('npx tsx tests/e2e/utils/seed-mobile.ts', { stdio: 'ignore' });
}

/** Collects console errors and uncaught page errors for assertion/reporting. */
function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  return errors;
}

async function gotoFamily(page: Page) {
  await page.goto('/family');
  await expect(page.getByTestId('mobile-bottom-nav')).toBeVisible();
  await expect(page.locator(`a[href="/family/${KEEP_CHILD_ID}"]`)).toBeVisible();
}

test.describe('Mobile — managed child actions and bottom navigation', () => {
  test.beforeEach(async () => {
    seed();
  });

  // -- A ---------------------------------------------------------------------
  test('A: tapping Reset password stays on Family and opens the reset flow', async ({ page }, testInfo) => {
    const errors = collectPageErrors(page);
    await loginAs(page, 'parent@test.com');
    await gotoFamily(page);

    const card = page.locator(`a[href="/family/${KEEP_CHILD_ID}"]`);
    await card.scrollIntoViewIfNeeded();

    const urlBefore = page.url();
    await page.screenshot({
      path: `${SHOTS}/${testInfo.project.name}-A-before-tap.png`,
      fullPage: true,
    });

    await card.getByTestId('reset-password-button').tap();

    // 2. URL must not change to the member profile route.
    await expect(page).toHaveURL(urlBefore);
    expect(page.url()).not.toContain(`/family/${KEEP_CHILD_ID}`);

    // 3. The reset flow is visibly open.
    const passwordField = card.getByLabel('Temporary password');
    await expect(passwordField).toBeVisible();
    await page.screenshot({
      path: `${SHOTS}/${testInfo.project.name}-A-after-tap.png`,
      fullPage: true,
    });

    // 5a. Error state: client-side validation rejects a weak password.
    await passwordField.fill('short');
    await card.getByTestId('reset-password-submit').tap();
    await expect(card.getByRole('status')).toContainText(/at least 8 characters/i);

    // 4 + 5b. Success state: a valid temporary password completes the flow.
    await passwordField.fill('TempPass123');
    await card.getByTestId('reset-password-submit').tap();
    await expect(card.getByRole('status')).toContainText(/Temporary password set/i, { timeout: 15000 });
    await expect(passwordField).toBeHidden();

    // 6. Still on Family.
    await expect(page).toHaveURL(urlBefore);

    // 7. The non-action part of the row still navigates to MemberProfile.
    await card.getByText(KEEP_CHILD_NAME).first().tap();
    await expect(page).toHaveURL(new RegExp(`/family/${KEEP_CHILD_ID}$`));

    expect(errors.filter(e => !/favicon|manifest|Download the React DevTools/i.test(e))).toEqual([]);
  });

  // -- B ---------------------------------------------------------------------
  test('B: Delete child opens a portalled dialog and deletes only the disposable child', async ({ page }, testInfo) => {
    const errors = collectPageErrors(page);

    const callableRequests: string[] = [];
    page.on('request', request => {
      if (request.url().includes('/deleteChild')) callableRequests.push(request.url());
    });

    await loginAs(page, 'parent@test.com');
    await gotoFamily(page);

    const card = page.locator(`a[href="/family/${DISPOSABLE_CHILD_ID}"]`);
    await card.scrollIntoViewIfNeeded();
    const urlBefore = page.url();

    // 1 + 2. Tap Delete child; no navigation.
    await card.getByTestId('delete-child-button').tap();
    await expect(page).toHaveURL(urlBefore);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.screenshot({
      path: `${SHOTS}/${testInfo.project.name}-B-dialog.png`,
      fullPage: false,
    });

    // 3 + 4. DOM proof: the dialog overlay is a direct child of <body>, so it
    // can neither be clipped by the member card nor stack under the nav.
    const portalProof = await dialog.evaluate(node => {
      const overlay = node.parentElement!;
      return {
        overlayParentIsBody: overlay.parentElement === document.body,
        overlayIsDirectBodyChild: Array.from(document.body.children).includes(overlay),
        insideMemberCard: !!node.closest('a[href^="/family/"]'),
        overlayZIndex: getComputedStyle(overlay).zIndex,
      };
    });
    expect(portalProof.overlayParentIsBody).toBe(true);
    expect(portalProof.overlayIsDirectBodyChild).toBe(true);
    expect(portalProof.insideMemberCard).toBe(false);

    const nav = page.getByTestId('mobile-bottom-nav');
    const navZ = await nav.evaluate(node => Number(getComputedStyle(node).zIndex));
    expect(Number(portalProof.overlayZIndex)).toBeGreaterThan(navZ);

    // The dialog is fully inside the viewport (not clipped).
    const box = (await dialog.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);

    // 5. Wrong name cannot submit.
    const nameInput = dialog.getByLabel(/delete/i).or(dialog.locator('#delete-child-name')).first();
    await nameInput.fill('Not The Name');
    const confirmButton = dialog.getByRole('button', { name: /delete/i }).last();
    await expect(confirmButton).toBeDisabled();

    // 6. Correct name enables submission.
    await nameInput.fill(DISPOSABLE_CHILD_NAME);
    await expect(confirmButton).toBeEnabled();

    // 7 + 10. Trigger deletion with a double tap. Both activations are
    // dispatched inside the same task so the second one races the first,
    // exactly like an impatient double tap on a phone; the component's busy
    // guard must collapse them into a single callable request.
    await confirmButton.dispatchEvent('touchstart');
    await confirmButton.evaluate((button: HTMLElement) => {
      button.click();
      button.click();
    });

    // 8. Disposable child disappears from Family.
    await expect(page.locator(`a[href="/family/${DISPOSABLE_CHILD_ID}"]`)).toHaveCount(0, { timeout: 20000 });
    await expect(dialog).toBeHidden();

    // 9. Siblings remain.
    await expect(page.locator(`a[href="/family/${KEEP_CHILD_ID}"]`)).toBeVisible();
    await expect(page.locator('a[href="/family/child1"]')).toBeVisible();

    // 10. Exactly one callable request was issued.
    expect(callableRequests.length).toBe(1);

    // URL never changed.
    await expect(page).toHaveURL(urlBefore);
    expect(errors.filter(e => !/favicon|manifest|Download the React DevTools/i.test(e))).toEqual([]);
  });

  // -- C ---------------------------------------------------------------------
  const routes: { name: string; path: string }[] = [
    { name: 'Home', path: '/' },
    { name: 'Tasks', path: '/tasks' },
    { name: 'Rewards', path: '/rewards' },
    { name: 'Family', path: '/family' },
    { name: 'MemberProfile', path: `/family/${KEEP_CHILD_ID}` },
  ];

  for (const route of routes) {
    test(`C: bottom navigation stays fixed on ${route.name}`, async ({ page }, testInfo) => {
      await loginAs(page, 'parent@test.com');
      await page.goto(route.path);

      const nav = page.getByTestId('mobile-bottom-nav');
      await expect(nav).toBeVisible();

      const viewport = page.viewportSize()!;

      const assertNav = async (label: string) => {
        // 3. Exactly one bottom nav in the DOM.
        await expect(nav).toHaveCount(1);

        // 4. Flush with the viewport bottom.
        const box = (await nav.boundingBox())!;
        expect(Math.abs(box.y + box.height - viewport.height)).toBeLessThanOrEqual(1);
        expect(box.x).toBeLessThanOrEqual(1);
        expect(Math.abs(box.width - viewport.width)).toBeLessThanOrEqual(1);

        // 5. Not rendered inside a member card.
        const insideCard = await nav.evaluate(node => !!node.closest('a[href^="/family/"]'));
        expect(insideCard).toBe(false);

        // 8. No horizontal overflow.
        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

        await page.screenshot({
          path: `${SHOTS}/${testInfo.project.name}-C-${route.name}-${label}.png`,
          fullPage: false,
        });
      };

      // 1. Scroll top.
      await assertNav('top');

      // 2. Scroll to the bottom.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(300);
      await assertNav('bottom');

      // 6. Page content is not hidden behind the nav: the main content area
      // reserves bottom padding at least as tall as the navigation bar.
      const navBox = (await nav.boundingBox())!;
      const mainPadding = await page.evaluate(() => {
        const main = document.querySelector('main')!;
        return parseFloat(getComputedStyle(main).paddingBottom);
      });
      expect(mainPadding).toBeGreaterThanOrEqual(navBox.height - 1);
    });
  }

  test('C: an open dialog renders above the bottom navigation', async ({ page }) => {
    await loginAs(page, 'parent@test.com');
    await gotoFamily(page);

    const card = page.locator(`a[href="/family/${DISPOSABLE_CHILD_ID}"]`);
    await card.getByTestId('delete-child-button').tap();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const nav = page.getByTestId('mobile-bottom-nav');
    const navBox = (await nav.boundingBox())!;

    // The topmost element at the centre of the navigation bar belongs to the
    // dialog overlay, proving the dialog stacks above the navigation.
    const topmostIsOverlay = await page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return !!element && !element.closest('[data-testid="mobile-bottom-nav"]');
    }, { x: navBox.x + navBox.width / 2, y: navBox.y + navBox.height / 2 });

    expect(topmostIsOverlay).toBe(true);
  });
});
