import { test, expect } from '@playwright/test';
import { loginAs, logout } from './utils/auth';
import { execSync } from 'child_process';

test.describe('Onboarding Flow', () => {
  test.beforeEach(async () => {
    execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
  });

  test('Complete onboarding flow with one child', async ({ page }) => {
    // Create a new user for this test
    await execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
    
    // Sign up a new user
    await page.goto('/signup');
    await page.fill('input[type="email"]', 'newuser@test.com');
    await page.fill('input[type="password"]', 'password123');
    await page.fill('input[type="text"]', 'New User');
    await page.click('button[type="submit"]');
    
    // Wait for onboarding to start
    await expect(page.locator('text="Welcome to Queki"')).toBeVisible();
    
    // Step 1: Create family
    await page.fill('input[type="text"]', 'Test Family');
    await page.click('button[type="submit"]');
    await expect(page.locator('text="Step 2 of 3"')).toBeVisible();
    
    // Step 2: Add family members
    await page.fill('input[placeholder="Name"]', 'Child One');
    await page.selectOption('select', 'child');
    await page.click('button:has-text("+")');
    
    // Verify child was added
    await expect(page.locator('text="Child One"')).toBeVisible();
    
    // Continue to step 3
    await page.click('button:has-text("Continue to Invite Code")');
    await expect(page.locator('text="Step 3 of 3"')).toBeVisible();
    
    // Verify invite code is displayed
    await expect(page.locator('text="Your Invite Code"')).toBeVisible();
    
    // Finish setup
    await page.click('button:has-text("Finish Setup")');
    
    // Should be redirected to dashboard
    await expect(page.locator('text="Queki"')).toBeVisible();
  });

  test('Onboarding with parent and child', async ({ page }) => {
    await execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
    
    // Sign up
    await page.goto('/signup');
    await page.fill('input[type="email"]', 'parentuser@test.com');
    await page.fill('input[type="password"]', 'password123');
    await page.fill('input[type="text"]', 'Parent User');
    await page.click('button[type="submit"]');
    
    // Step 1: Create family
    await page.fill('input[type="text"]', 'Parent-Child Family');
    await page.click('button[type="submit"]');
    
    // Step 2: Add parent member
    await page.fill('input[placeholder="Name"]', 'Parent User');
    await page.selectOption('select', 'parent');
    await page.click('button:has-text("+")');
    
    // Add child member
    await page.fill('input[placeholder="Name"]', 'Child User');
    await page.selectOption('select', 'child');
    await page.click('button:has-text("+")');
    
    // Verify both members added
    await expect(page.locator('text="Parent User"')).toBeVisible();
    await expect(page.locator('text="Child User"')).toBeVisible();
    
    // Continue to step 3
    await page.click('button:has-text("Continue to Invite Code")');
    await expect(page.locator('text="Your Invite Code"')).toBeVisible();
    
    // Finish setup
    await page.click('button:has-text("Finish Setup")');
    await expect(page.locator('text="Queki"')).toBeVisible();
  });

  test('Onboarding validation - empty name', async ({ page }) => {
    await execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
    
    // Sign up
    await page.goto('/signup');
    await page.fill('input[type="email"]', 'validationuser@test.com');
    await page.fill('input[type="password"]', 'password123');
    await page.fill('input[type="text"]', 'Validation User');
    await page.click('button[type="submit"]');
    
    // Step 1: Create family
    await page.fill('input[type="text"]', 'Validation Family');
    await page.click('button[type="submit"]');
    
    // Try to add member with empty name
    await page.click('button:has-text("+")');
    
    // Should show validation error
    await expect(page.locator('text="Member name is required"')).toBeVisible();
    
    // Try to continue without members
    await page.click('button:has-text("Continue to Invite Code")');
    await expect(page.locator('text="Must add at least one member"')).toBeVisible();
  });

  test('Onboarding duplicate member prevention', async ({ page }) => {
    await execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
    
    // Sign up
    await page.goto('/signup');
    await page.fill('input[type="email"]', 'duplicateuser@test.com');
    await page.fill('input[type="password"]', 'password123');
    await page.fill('input[type="text"]', 'Duplicate User');
    await page.click('button[type="submit"]');
    
    // Step 1: Create family
    await page.fill('input[type="text"]', 'Duplicate Family');
    await page.click('button[type="submit"]');
    
    // Add first member
    await page.fill('input[placeholder="Name"]', 'First Child');
    await page.click('button:has-text("+")');
    
    // Try to add duplicate member
    await page.fill('input[placeholder="Name"]', 'First Child');
    await page.click('button:has-text("+")');
    
    // Should show duplicate error
    await expect(page.locator('text="Member already exists"')).toBeVisible();
    
    // Verify only one member was added
    await expect(page.locator('text="First Child"')).toHaveCount(1);
  });

  test('Onboarding Enter key behavior', async ({ page }) => {
    await execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
    
    // Sign up
    await page.goto('/signup');
    await page.fill('input[type="email"]', 'enterkeyuser@test.com');
    await page.fill('input[type="password"]', 'password123');
    await page.fill('input[type="text"]', 'Enter Key User');
    await page.click('button[type="submit"]');
    
    // Step 1: Create family
    await page.fill('input[type="text"]', 'Enter Key Family');
    await page.click('button[type="submit"]');
    
    // Fill in member name and press Enter
    await page.fill('input[placeholder="Name"]', 'Enter Key Child');
    await page.press('input[placeholder="Name"]', 'Enter');
    
    // Should add member (Enter should not submit form or advance step)
    await expect(page.locator('text="Enter Key Child"')).toBeVisible();
    
    // Should still be on step 2
    await expect(page.locator('text="Step 2 of 3"')).toBeVisible();
  });

  test('Onboarding add child member', async ({ page }) => {
    await execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
    
    // Sign up
    await page.goto('/signup');
    await page.fill('input[type="email"]', 'childuser@test.com');
    await page.fill('input[type="password"]', 'password123');
    await page.fill('input[type="text"]', 'Child Test User');
    await page.click('button[type="submit"]');
    
    // Step 1: Create family
    await page.fill('input[type="text"]', 'Child Test Family');
    await page.click('button[type="submit"]');
    
    // Step 2: Add child member
    await page.fill('input[placeholder="Name"]', 'Test Child');
    await page.selectOption('select', 'child');
    await page.click('button:has-text("+")');
    
    // Verify child was added to the list
    await expect(page.locator('text="Test Child"')).toBeVisible();
    await expect(page.locator('text="Child"')).toBeVisible();
    
    // Verify input was cleared
    await expect(page.locator('input[placeholder="Name"]')).toHaveValue('');
  });

  test('Onboarding add parent member', async ({ page }) => {
    await execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
    
    // Sign up
    await page.goto('/signup');
    await page.fill('input[type="email"]', 'parentuser@test.com');
    await page.fill('input[type="password"]', 'password123');
    await page.fill('input[type="text"]', 'Parent Test User');
    await page.click('button[type="submit"]');
    
    // Step 1: Create family
    await page.fill('input[type="text"]', 'Parent Test Family');
    await page.click('button[type="submit"]');
    
    // Step 2: Add parent member
    await page.fill('input[placeholder="Name"]', 'Test Parent');
    await page.selectOption('select', 'parent');
    await page.click('button:has-text("+")');
    
    // Verify parent was added to the list
    await expect(page.locator('text="Test Parent"')).toBeVisible();
    await expect(page.locator('text="Parent"')).toBeVisible();
    
    // Verify input was cleared
    await expect(page.locator('input[placeholder="Name"]')).toHaveValue('');
  });

  test('Onboarding double-click prevention', async ({ page }) => {
    await execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
    
    // Sign up
    await page.goto('/signup');
    await page.fill('input[type="email"]', 'doubleclickuser@test.com');
    await page.fill('input[type="password"]', 'password123');
    await page.fill('input[type="text"]', 'Double Click User');
    await page.click('button[type="submit"]');
    
    // Step 1: Create family
    await page.fill('input[type="text"]', 'Double Click Family');
    await page.click('button[type="submit"]');
    
    // Fill in member name
    await page.fill('input[placeholder="Name"]', 'Double Click Child');
    
    // Double-click the + button
    await page.dblclick('button:has-text("+")');
    
    // Should add member only once
    await expect(page.locator('text="Double Click Child"')).toHaveCount(1);
  });

  test('Onboarding retry after partial setup', async ({ page }) => {
    await execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
    
    // Sign up
    await page.goto('/signup');
    await page.fill('input[type="email"]', 'retryuser@test.com');
    await page.fill('input[type="password"]', 'password123');
    await page.fill('input[type="text"]', 'Retry User');
    await page.click('button[type="submit"]');
    
    // Step 1: Create family
    await page.fill('input[type="text"]', 'Retry Family');
    await page.click('button[type="submit"]');
    
    // Add one member
    await page.fill('input[placeholder="Name"]', 'First Member');
    await page.click('button:has-text("+")');
    
    // Refresh the page (simulating network issue)
    await page.reload();
    
    // Should resume with existing family
    await expect(page.locator('text="First Member"')).toBeVisible();
    
    // Add second member
    await page.fill('input[placeholder="Name"]', 'Second Member');
    await page.click('button:has-text("+")');
    
    await expect(page.locator('text="Second Member"')).toBeVisible();
    
    // Complete setup
    await page.click('button:has-text("Continue to Invite Code")');
    await page.click('button:has-text("Finish Setup")');
    await expect(page.locator('text="Queki"')).toBeVisible();
  });

  test('Onboarding no duplicate family on retry', async ({ page }) => {
    await execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
    
    // Sign up
    await page.goto('/signup');
    await page.fill('input[type="email"]', 'noduplicateuser@test.com');
    await page.fill('input[type="password"]', 'password123');
    await page.fill('input[type="text"]', 'No Duplicate User');
    await page.click('button[type="submit"]');
    
    // Step 1: Create family
    await page.fill('input[type="text"]', 'No Duplicate Family');
    await page.click('button[type="submit"]');
    
    // Add members
    await page.fill('input[placeholder="Name"]', 'Member One');
    await page.click('button:has-text("+")');
    
    await page.fill('input[placeholder="Name"]', 'Member Two');
    await page.click('button:has-text("+")');
    
    // Complete setup
    await page.click('button:has-text("Continue to Invite Code")');
    await page.click('button:has-text("Finish Setup")');
    
    // Logout
    await logout(page);
    
    // Sign in again (simulating retry)
    await loginAs(page, 'noduplicateuser@test.com');
    
    // Should be on dashboard, not onboarding
    await expect(page.locator('text="Queki"')).toBeVisible();
    await expect(page.locator('text="Welcome to Queki"')).not.toBeVisible();
  });
});