// Production login helper for Phase 5 smoke tests.
// Logs into the LIVE familyquest-beta-402cb project (no emulator).
import { Page, expect } from '@playwright/test';

export async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.waitForSelector('input[type="email"]');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  // Wait for the login form to disappear (auth succeeded → route guard redirects).
  await expect(page.locator('input[type="email"]')).toHaveCount(0, { timeout: 20000 });
  // Confirm we landed on an authenticated surface (no longer on /login).
  await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 10000 });
  // The app's auth bootstrap may show a transient "User profile is not
  // available yet" connection error right after login. Allow it to settle.
  await page.waitForTimeout(3000);
}
