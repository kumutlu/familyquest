import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { loginAs } from './utils/auth';

/**
 * FEATURE-PARITY BROWSER QA (Queki v2).
 *
 * Proves — via real UI navigation (never typed URLs) — that every recovered
 * product area is discoverable from the app shell for each role:
 *   Owner/Parent: Goals, Wallets, Cat Box, History, Notifications, Settings, Help
 *   Child:        Goals, Wallet,   History, Notifications, Settings, Help
 *
 * Requires the Firebase emulator suite — run via `npm run test:e2e`.
 */
test.describe('Feature parity — More hub navigation', () => {
  test.beforeEach(async () => {
    execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
  });

  async function openMore(page: import('@playwright/test').Page) {
    await page.getByTestId('more-menu-button').click();
    await expect(page.getByTestId('more-menu')).toBeVisible();
  }

  const parentDestinations: Array<[string, RegExp]> = [
    ['more-goals', /\/goals/],
    ['more-wallets', /\/wallets/],
    ['more-cat-box', /\/pet-box/],
    ['more-history', /\/history/],
    ['more-notifications', /\/notifications/],
    ['more-settings', /\/settings/],
    ['more-help', /\/help/],
  ];

  for (const [testId, urlPattern] of parentDestinations) {
    test(`owner reaches ${urlPattern} from the More hub`, async ({ page }) => {
      await loginAs(page, 'owner@test.com');
      await openMore(page);
      await page.getByTestId(testId).click();
      await expect(page).toHaveURL(urlPattern);
      // The destination actually rendered app content (not a blank screen).
      await expect(page.locator('main')).not.toBeEmpty();
      // QA evidence screenshots for the recovered areas.
      if (['more-goals', 'more-cat-box', 'more-wallets'].includes(testId)) {
        await page.screenshot({ path: `screenshots/feature-parity/owner-${testId}.png`, fullPage: true });
      }
    });
  }

  const childDestinations: Array<[string, RegExp]> = [
    ['more-goals', /\/goals/],
    ['more-wallet', /\/wallet$/],
    ['more-history', /\/history/],
    ['more-notifications', /\/notifications/],
    ['more-settings', /\/settings/],
    ['more-help', /\/help/],
  ];

  for (const [testId, urlPattern] of childDestinations) {
    test(`child reaches ${urlPattern} from the More hub`, async ({ page }) => {
      await loginAs(page, 'child@test.com');
      await openMore(page);
      await page.getByTestId(testId).click();
      await expect(page).toHaveURL(urlPattern);
      await expect(page.locator('main')).not.toBeEmpty();
    });
  }

  test('child never sees parent-only destinations', async ({ page }) => {
    await loginAs(page, 'child@test.com');
    await openMore(page);
    await expect(page.getByTestId('more-cat-box')).toHaveCount(0);
    await expect(page.getByTestId('more-wallets')).toHaveCount(0);
  });
});
