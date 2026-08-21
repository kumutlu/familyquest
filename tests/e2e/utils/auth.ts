import { Page, type TestInfo } from '@playwright/test';
import { expectManagedChildReady, expectOwnerReady, expectSignedOutReady } from './readiness';

export async function loginAs(page: Page, email: string, testInfo?: TestInfo) {
  await page.goto('/login');

  // Wait for the login form to be visible
  await page.waitForSelector('input[type="email"]');

  // Fill in the credentials
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', 'password123'); // Password is deterministic in emulator

  // Submit the form
  await page.click('button[type="submit"]');

  await page.waitForURL(url => url.pathname !== '/login', { timeout: 15000 });
  if (email.startsWith('child')) await expectManagedChildReady(page, testInfo);
  else await expectOwnerReady(page, testInfo);
}

export async function logout(page: Page, testInfo?: TestInfo) {
  // Dismiss any open modal/overlay first so the Profile menu is clickable.
  await page.keyboard.press('Escape').catch(() => {});

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
      await expectSignedOutReady(page, testInfo).catch(() => {});
    }
  }
  // Fallback: ensure we are on the login page.
  await page.goto('/login');
  await expectSignedOutReady(page, testInfo);
}
