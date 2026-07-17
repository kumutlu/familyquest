import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { loginAs, logout } from './utils/auth';
import { db, seedTestFamily } from './utils/seed';
import { Timestamp } from 'firebase-admin/firestore';

/**
 * Regression test for the collapsed NotificationCenter content area.
 *
 * Root cause (see src/components/layout/NotificationCenter.tsx):
 * The tabs were nested *inside* the sticky header block, and that header
 * block was a flex child of the `flex flex-col` sheet WITHOUT `shrink-0`.
 * Under the sheet's `max-h` constraint the flex algorithm shrank the
 * header/tabs block and the `flex-1 min-h-0` content collapsed to 0px,
 * hiding tabs, rows and footer.
 *
 * The fix makes the header `shrink-0`, lifts the tabs out into their own
 * `shrink-0` sibling, and keeps the content as `flex-1 min-h-0 overflow-y-auto`.
 *
 * This test asserts the resulting structure is visible and the content
 * container has a real height.
 */
test.describe('NotificationCenter layout', () => {
  test.beforeEach(async () => {
    execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });

    // Seed a notification for child1 so the list renders a real row.
    await db
      .doc('families/test-fam/notifications/notif-1')
      .set({
        familyId: 'test-fam',
        type: 'task_approved',
        actorId: 'parent1',
        recipientIds: ['child1'],
        title: 'Room cleaned!',
        body: 'Your task was approved.',
        entityType: 'task',
        entityId: 'task1',
        actionUrl: '/tasks',
        dedupeKey: 'notif-1',
        createdAt: Timestamp.now(),
      });
  });

  test('tabs, first row and content container are visible with real height', async ({ page }) => {
    await loginAs(page, 'child@test.com');

    // Open the notification center via the bell button.
    const bell = page.getByRole('button', { name: /Notifications/ });
    await expect(bell).toBeVisible();
    await bell.click();

    const dialog = page.getByRole('dialog', { name: 'Notifications' });
    await expect(dialog).toBeVisible();

    // Tabs must be visible.
    const tablist = page.getByRole('tablist', { name: 'Notification filters' });
    await expect(tablist).toBeVisible();
    await expect(tablist.getByRole('tab', { name: /All/ })).toBeVisible();

    // First notification row must be visible.
    const firstRow = dialog
      .getByRole('button')
      .filter({ hasText: 'Room cleaned!' })
      .first();
    await expect(firstRow).toBeVisible();

    // The scrollable content container must have a real height (> 100px).
    const contentHeight = await dialog
      .locator('#notif-tabpanel')
      .evaluate(el => el.clientHeight);

    // Log actual clientHeight values for debugging (per investigation step 5).
    const heights = await page.evaluate(() => {
      const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
      const h = (el: HTMLElement | null) => (el ? el.clientHeight : null);
      return {
        dialog: h(q('[role="dialog"][aria-label="Notifications"]')),
        sheet: h(q('[role="dialog"][aria-label="Notifications"]')),
        header: h(q('[role="dialog"][aria-label="Notifications"] > div')),
        tabs: h(q('[role="tablist"]')),
        content: h(q('#notif-tabpanel')),
        footer: h(
          Array.from(document.querySelectorAll('[role="dialog"] button')).find(b =>
            b.textContent?.includes('View all notifications'),
          )?.closest('div') as HTMLElement | undefined ?? null,
        ),
      };
    });
    console.log('[NotificationCenter heights]', JSON.stringify(heights));

    expect(contentHeight).toBeGreaterThan(100);
  });
});
