import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'child_process';
import { loginAs, logout } from './utils/auth';

test.describe('DEBUG profile edit', () => {
  test.beforeEach(async () => {
    execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
  });

  test('debug child submit + parent view', async ({ page }) => {
    const logs: string[] = [];
    page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));

    await loginAs(page, 'child@test.com');
    await page.getByRole('button', { name: 'Profile menu' }).click();
    await page.getByRole('menuitem', { name: 'Edit Profile' }).click();
    const nameInput = page.getByLabel('Display Name');
    await nameInput.fill('Leo The Brave');
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await page.waitForTimeout(3000);
    await logout(page);

    await loginAs(page, 'parent@test.com');
    await page.waitForTimeout(3000);
    const bodyText = await page.locator('body').innerText();
    console.log('HAS "Approval Center":', bodyText.includes('Approval Center'));
    console.log('HAS "Pending":', bodyText.includes('Pending'));
    console.log('HAS "Profile Update Request":', bodyText.includes('Profile Update Request'));
    console.log('HAS "All caught up":', bodyText.includes("You're all caught up"));
    // Dump the section around Approval Center
    const idx = bodyText.indexOf('Approval Center');
    if (idx >= 0) {
      console.log('AROUND APPROVAL CENTER:\n', bodyText.slice(idx, idx + 600));
    }
    console.log('CONSOLE LOGS:\n', logs.join('\n'));
  });
});
