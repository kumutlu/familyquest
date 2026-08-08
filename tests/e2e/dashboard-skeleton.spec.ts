// P1 regression (browser): the child dashboard summary card stayed in a
// skeleton state forever when the gamification projection document does not
// exist (the default state for a freshly seeded / real production child).
//
// The seeded emulator family intentionally has NO `gamificationSummaries`
// document for child1, which reproduces the production condition exactly.
//
// Required behaviour verified here:
//   - once dashboard data is loaded, no permanent skeletons may remain
//   - the fallback UI renders instead of a skeleton for missing optional data
// NOTE: seeding runs OUT-OF-PROCESS before this spec
// (`npx tsx -e "import('./tests/e2e/utils/seed').then(m => m.seedTestFamily())"`)
// because importing firebase-admin inside Playwright triggers a jwks-rsa ESM
// cache error — the same constraint documented in production-smoke.spec.ts.
import { test, expect } from '@playwright/test';
import { loginAs } from './utils/auth';

test.describe('Dashboard — no permanent skeletons', () => {
  test('child dashboard has zero permanent skeletons after initial load', async ({ page }) => {
    test.setTimeout(60000);

    await loginAs(page, 'child@test.com');
    await page.goto('/');

    // Dashboard data has loaded: greeting + stat tiles are rendered.
    await expect(page.locator('text=/Good Morning/').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Total Points').first()).toBeVisible();
    await expect(page.locator('text=Day Streak').first()).toBeVisible();

    // Allow any genuinely in-flight request to settle. `networkidle` is not
    // usable here: Firestore keeps a long-lived listen stream open forever.
    await page.waitForTimeout(4000);

    // The gamification projection is missing → fallback card, never a skeleton.
    await expect(page.getByTestId('gamification-summary-unavailable')).toBeVisible();
    await expect(page.getByTestId('gamification-summary-skeleton')).toHaveCount(0);

    // No element anywhere on the dashboard may remain busy/pulsing.
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(page.locator('.animate-pulse')).toHaveCount(0);
  });
});
