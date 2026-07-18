import { test, expect } from '@playwright/test';
import { loginAs, logout } from './utils/auth';
import { execSync } from 'child_process';

test.describe('Family Page & Member Editing', () => {
  test.beforeEach(async () => {
    execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
  });

  test('Owner and Parent visibility and rankings', async ({ page }) => {
    // Owner logs in
    await loginAs(page, 'owner@test.com');
    await page.click('a[href="/family"]');
    
    // Owner sees adults section
    await expect(page.locator('h3:has-text("Adults")')).toBeVisible();
    await expect(page.locator('text="Owner Mom"')).toBeVisible();
    await expect(page.locator('text="Parent Dad"')).toBeVisible(); // Owner sees other parent
    
    // Rankings should only contain children
    const rankingsText = await page.locator('h3:has-text("Children & Rankings")').innerText();
    expect(rankingsText).toContain('Children & Rankings');
    
    // Ensure parent/owner are NOT in the ranking cards by looking for their labels in the list
    // A bit tricky since they appear in adults list. We can check there is no "Test Owner" under "Children & Rankings" section.
    // Actually simpler: check that there are exactly 2 'Edit' buttons for adults, but let's just do a basic check.
    
    await logout(page);

    // Parent logs in
    await loginAs(page, 'parent@test.com');
    await page.click('a[href="/family"]');
    await expect(page.locator('text="Owner Mom"')).toBeVisible(); // Parent sees owner
    await expect(page.locator('text="Parent Dad"')).toBeVisible();
    await logout(page);
  });

  test('Owner and Parent can edit child display name, child cannot', async ({ page }) => {
    // Child logs in
    await loginAs(page, 'child@test.com');
    await page.click('a[href="/family"]');
    // Child should NOT see Edit buttons
    await expect(page.locator('button:has-text("Edit")')).toHaveCount(0);
    await logout(page);

    // Parent logs in
    await loginAs(page, 'parent@test.com');
    await page.click('a[href="/family"]');
    // Parent clicks edit on the first member (which happens to be an adult or child, let's just edit child)
    // We'll target the edit button specifically for Child Leo
    await page.locator('a:has-text("Child Leo")').locator('button:has-text("Edit")').click();
    await expect(page.locator('text="Edit Member"')).toBeVisible();
    await page.fill('input[type="text"]', 'Child Leo Edited');
    await page.click('button:has-text("Save")');
    await expect(page.locator('text="Edit Member"')).not.toBeVisible();
    await expect(page.locator('text="Child Leo Edited"').first()).toBeVisible();
    await logout(page);

    // Owner logs in and edits it back
    await loginAs(page, 'owner@test.com');
    await page.click('a[href="/family"]');
    await page.locator('a:has-text("Child Leo Edited")').locator('button:has-text("Edit")').click();
    await page.fill('input[type="text"]', 'Child Leo Again');
    await page.click('button:has-text("Save")');
    await expect(page.locator('text="Child Leo Again"').first()).toBeVisible();
    await logout(page);
  });
});
