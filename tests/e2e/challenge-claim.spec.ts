import { test, expect } from '@playwright/test';
import { loginAs, logout } from './utils/auth';
import { execSync } from 'child_process';

/**
 * End-to-end verification of the Family Challenge claim + child celebration
 * flow (the fix committed in 03812d3). Runs against the Firebase Emulator
 * suite (Firestore :8080, Auth :9099) via the local dev server started by
 * Playwright's webServer hook.
 *
 * Covers the post-commit verification plan:
 *   2. parent claims end-to-end
 *   3. each child receives points exactly once
 *   4. child sees celebration on next login
 *   5. dismiss celebration
 *   6. refresh/relogin -> does not replay
 *   7. sibling still gets their own celebration
 *   8. parent never sees it
 */
const EMULATOR = 'http://127.0.0.1:8080';
const PROJECT = 'familyquest-beta-402cb';
const FAMILY = 'test-fam';
const REWARD = 25;

type Points = { rewardPoints: number; lifetimeXP: number };

async function readUser(uid: string): Promise<Points> {
  const res = await fetch(
    `${EMULATOR}/v1/projects/${PROJECT}/databases/(default)/documents/users/${uid}`,
  );
  const data = (await res.json()) as { fields?: Record<string, { integerValue?: string }> };
  const f = data.fields ?? {};
  return {
    rewardPoints: Number(f.rewardPoints?.integerValue ?? 0),
    lifetimeXP: Number(f.lifetimeXP?.integerValue ?? 0),
  };
}

const overlay = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid="challenge-celebration-overlay"]');

test.describe('Family Challenge claim + child celebration', () => {
  test.beforeEach(async () => {
    execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
    execSync('npx tsx tests/e2e/utils/seedChallenge.ts', { stdio: 'ignore' });
  });

  test('parent claims, each child gets +25 once, celebration shows/dismisses, parent never sees', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

    const before1 = await readUser('child1');
    const before2 = await readUser('child2');

    // 2. Parent claims end-to-end
    await loginAs(page, 'parent@test.com');
    await page.click('a[href="/family"]');
    const claimBtn = page.getByRole('button', { name: /Claim/i });
    await expect(claimBtn).toBeVisible();
    await claimBtn.click();

    // Claim closes the challenge -> no "Claim" button remains
    await expect(page.getByRole('button', { name: /Claim/i })).toHaveCount(0, { timeout: 10000 });

    const after1 = await readUser('child1');
    const after2 = await readUser('child2');

    // 3. each child receives points exactly once (+REWARD)
    expect(after1.rewardPoints).toBe(before1.rewardPoints + REWARD);
    expect(after1.lifetimeXP).toBe(before1.lifetimeXP + REWARD);
    expect(after2.rewardPoints).toBe(before2.rewardPoints + REWARD);
    expect(after2.lifetimeXP).toBe(before2.lifetimeXP + REWARD);

    await logout(page);

    // 4. Child1 sees celebration on next login
    await loginAs(page, 'child@test.com');
    await expect(overlay(page)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="challenge-celebration-body"]')).toHaveText(
      `You earned +${REWARD} points`,
    );

    // 5. dismiss celebration
    await page.locator('[data-testid="challenge-celebration-dismiss"]').click();
    await expect(overlay(page)).toHaveCount(0);

    // 6. relogin -> does not replay
    await logout(page);
    await loginAs(page, 'child@test.com');
    await expect(overlay(page)).toHaveCount(0, { timeout: 10000 });

    await logout(page);

    // 7. sibling still gets their own celebration
    await loginAs(page, 'child2@test.com');
    await expect(overlay(page)).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid="challenge-celebration-dismiss"]').click();
    await expect(overlay(page)).toHaveCount(0);
    await logout(page);

    // 8. parent never sees it
    await loginAs(page, 'parent@test.com');
    await expect(overlay(page)).toHaveCount(0, { timeout: 10000 });
    await logout(page);

    // console / Firestore errors (filter benign favicon noise)
    const realErrors = consoleErrors.filter((e) => !/favicon/i.test(e));
    console.log('CONSOLE_ERRORS_RAW:', JSON.stringify(consoleErrors));
    expect(realErrors).toEqual([]);
  });
});
