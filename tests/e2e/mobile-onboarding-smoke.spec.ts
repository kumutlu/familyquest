import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import {
  driveToStep,
  signUpFromS7,
  completePostAuth,
  completeEmailOnboarding,
  getOnboardingOutcome,
  expectDashboard,
  type OnboardingPersona,
} from './utils/onboardingFlow';

/**
 * Final mobile smoke for the Refined Queki onboarding (section 7 of the gate).
 *
 * Runs on the mobile config's iPhone viewports (390×844 primary, 430×932 extra).
 * Exercises the real S1→S7→auth→P1→P2→P3→dashboard flow for the
 * Kemal / Dad / Osman / Umutlu Family persona and asserts the regression
 * contract: P1 never surfaces a raw "User not found", exactly-once writes,
 * no indefinite spinner, reachable CTA, plus dark-mode coherence and
 * reduced-motion functionality.
 *
 * Requires the Firestore + Auth emulators (already running for the e2e gate).
 */

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`;
}

function persona(): OnboardingPersona {
  return {
    parent: 'Kemal',
    relationship: 'Dad',
    child: 'Osman',
    family: 'Umutlu Family',
    email: uniqueEmail('mobile'),
    password: 'password123',
  };
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

function luminance([r, g, b]: readonly number[]): number {
  const f = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
}

function parseRgb(value: string): readonly number[] | null {
  const m = value.match(/rgba?\(([^)]+)\)/);
  return m ? m[1].split(',').map((x) => parseFloat(x)) : null;
}

test.describe('Mobile onboarding smoke — Refined Queki (390×844)', () => {
  test('full flow creates exactly one family/child/task and never shows "User not found"', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    const data = persona();
    await page.goto('/');

    // S1 value proposition present; legacy copy absent.
    await expect(page.getByRole('heading', { name: /small wins\. big habits\./i })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText(/welcome to queki/i)).toHaveCount(0);

    await completeEmailOnboarding(page, data);

    // P1 must not have surfaced a raw "User not found" string at any point.
    await expect(page.getByText(/user not found/i)).toHaveCount(0);
    const rawUserNotFound = errors.filter((e) => /user not found/i.test(e));
    expect(rawUserNotFound, rawUserNotFound.join('\n')).toEqual([]);

    // Reached the dashboard (not stuck on a spinner / error).
    await expectDashboard(page);

    // Authoritative exactly-once outcome.
    const outcome = await getOnboardingOutcome(data.email);
    expect(outcome.familyId, 'familyId set').toBeTruthy();
    expect(outcome.familyCount, 'exactly one family').toBe(1);
    expect(outcome.childCount, 'exactly one first managed child').toBe(1);
    expect(outcome.taskCount, 'exactly one first task').toBe(1);

    // No auth/routing/family console errors during the run.
    const relevant = errors.filter((e) =>
      /auth|route|router|family|permission|firestore|user not found/i.test(e),
    );
    expect(relevant, relevant.join('\n')).toEqual([]);
  });

  test('dark mode is coherent through the onboarding flow and dashboard', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('queki:appearance', 'dark');
      } catch {
        /* ignore */
      }
    });
    const data = persona();
    await page.goto('/');
    await completeEmailOnboarding(page, data);
    await expectDashboard(page);

    // The dark theme is actually applied to the document.
    const isDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark'),
    );
    expect(isDark, 'dark class applied to <html>').toBe(true);

    // The app shell background is dark (not a light surface that survived).
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const parts = parseRgb(bg);
    expect(parts, `body background parseable: ${bg}`).not.toBeNull();
    expect(luminance(parts ?? [255, 255, 255]), `body background is dark: ${bg}`).toBeLessThan(0.25);
  });

  test('reduced motion still completes the onboarding flow', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const data = persona();
    await page.goto('/');
    await completeEmailOnboarding(page, data);
    await expectDashboard(page);

    const outcome = await getOnboardingOutcome(data.email);
    expect(outcome.familyCount).toBe(1);
    expect(outcome.childCount).toBe(1);
    expect(outcome.taskCount).toBe(1);
  });
});
