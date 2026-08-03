import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'child_process';
import { loginAs } from './utils/auth';

/**
 * Regression guard for the single-card Member Profile cleanup.
 *
 * Before the cleanup the profile rendered two progression surfaces: the purple
 * `profile-progression` card AND the dashboard `GamificationSummaryCard`
 * (`gamification-summary`). That produced duplicate level labels, duplicate
 * progress bars and vertical overflow on mobile.
 *
 * This spec locks the supported contract in a real browser:
 *   - exactly one purple progression card
 *   - exactly one level label
 *   - exactly one progress bar
 *   - no duplicate `gamification-summary` card on the profile
 *   - Current Streak and Best Streak visible inside the single card
 *   - no horizontal/vertical overflow on desktop or mobile viewports
 */

const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };

async function openOwnProfile(page: Page) {
  await loginAs(page, 'child@test.com');
  await page.goto('/family');
  // The member card links to /family/:id
  const memberLink = page.locator('a[href^="/family/"]').first();
  await memberLink.click();
  await expect(page.getByTestId('profile-progression')).toBeVisible({ timeout: 15000 });
}

async function assertNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return {
      horizontal: doc.scrollWidth - doc.clientWidth,
      cardOverflow: Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="profile-progression"]'),
      ).map((el) => el.scrollWidth - el.clientWidth),
    };
  });
  expect(overflow.horizontal).toBeLessThanOrEqual(1);
  for (const value of overflow.cardOverflow) {
    expect(value).toBeLessThanOrEqual(1);
  }
}

test.describe('Member Profile — single progression card', () => {
  test.beforeEach(async () => {
    execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
  });

  test('renders exactly one progression card on desktop', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openOwnProfile(page);

    await expect(page.getByTestId('profile-progression')).toHaveCount(1);
    await expect(page.getByTestId('profile-level')).toHaveCount(1);
    await expect(page.getByTestId('profile-progress-bar')).toHaveCount(1);
    await expect(page.getByRole('progressbar')).toHaveCount(1);

    // The dashboard summary card must not be duplicated onto the profile page.
    await expect(page.getByTestId('gamification-summary')).toHaveCount(0);
    await expect(page.getByTestId('gamification-summary-skeleton')).toHaveCount(0);

    // Streaks live inside the single card.
    await expect(page.getByTestId('profile-current-streak')).toBeVisible();
    await expect(page.getByTestId('profile-best-streak')).toBeVisible();

    await assertNoOverflow(page);
    await page.screenshot({
      path: 'screenshots/profile-progression-desktop.png',
      fullPage: true,
    });
  });

  test('renders exactly one progression card on mobile without overflow', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await openOwnProfile(page);

    await expect(page.getByTestId('profile-progression')).toHaveCount(1);
    await expect(page.getByTestId('profile-level')).toHaveCount(1);
    await expect(page.getByTestId('profile-progress-bar')).toHaveCount(1);
    await expect(page.getByTestId('gamification-summary')).toHaveCount(0);
    await expect(page.getByTestId('profile-current-streak')).toBeVisible();
    await expect(page.getByTestId('profile-best-streak')).toBeVisible();

    await assertNoOverflow(page);
    await page.screenshot({
      path: 'screenshots/profile-progression-mobile.png',
      fullPage: true,
    });
  });
});
