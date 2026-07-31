import { Page, expect } from '@playwright/test';

export async function loginAs(page: Page, email: string) {
  await page.goto('/login');

  // Wait for the login form to be visible
  await page.waitForSelector('input[type="email"]');

  // Fill in the credentials
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', 'password123'); // Password is deterministic in emulator

  // Submit the form
  await page.click('button[type="submit"]');

  // Wait for the dashboard to load
  await expect(page.locator('text="Queki"').first()).toBeVisible({ timeout: 10000 });
}

export async function logout(page: Page) {
  // Dismiss any open modal/overlay first so the Profile menu is clickable.
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);

  // The app persists Firebase Auth in IndexedDB, so clearing only
  // localStorage/sessionStorage is not enough — the previous session would
  // re-hydrate and the next login would be detached. Perform a real sign-out
  // through the Profile menu so Firebase auth state is cleared.
  const profileButton = page.locator('button[aria-label="Profile menu"]');
  if (await profileButton.isVisible().catch(() => false)) {
    await profileButton.click();
    const signOutButton = page.locator('[role="menuitem"]', { hasText: 'Sign Out' });
    if (await signOutButton.isVisible().catch(() => false)) {
      await signOutButton.click();
      await page.waitForSelector('input[type="email"]', { timeout: 10000 }).catch(() => {});
    }
  }
  // Fallback: ensure we are on the login page.
  await page.goto('/login');
  await page.waitForSelector('input[type="email"]', { timeout: 10000 }).catch(() => {});
}
