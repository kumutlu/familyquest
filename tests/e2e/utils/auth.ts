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
  await expect(page.locator('text="FamilyQuest"').first()).toBeVisible({ timeout: 10000 });
}

export async function logout(page: Page) {
  // If the user menu is open or a logout button is visible, click it
  // Wait, does the app have a logout button? Yes, in the Settings or Header
  // Let's assume there's a sign-out button we can click or we can clear localStorage
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/login');
}
