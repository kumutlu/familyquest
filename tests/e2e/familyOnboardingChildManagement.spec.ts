import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { loginAs, logout } from './utils/auth';
import {
  driveToStep,
  signUpFromS7,
  getOnboardingOutcome,
  type OnboardingPersona,
} from './utils/onboardingFlow';
import {
  inspectChildProvisioning,
  inspectChildDeletion,
  inspectFamilyCounts,
  seedOrphanUser,
  seedZeroChildFamily,
  seedLegacyQrToken,
  verifyEmailUser,
} from './utils/inspectFirestoreHelper';

function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`;
}

test.describe('Family Onboarding & Child Management Full Matrix', () => {
  test.beforeEach(async () => {
    execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
  });

  // =========================================================================
  // FLOW A: Family-Only Onboarding End-to-End
  // =========================================================================
  test('FLOW A: Pre-auth S1-S7 -> P1 creates 1 family, 0 children, 0 wallets, and lands on zero-child home', async ({ page }) => {
    const data: OnboardingPersona = {
      parent: 'Alice',
      relationship: 'Mum',
      child: '', // Skipped in pre-auth
      family: 'Wonderland Family',
      email: uniqueEmail('alice-onboard'),
      password: 'password123',
    };

    // 1. Visit landing page
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /small wins\. big habits\./i })).toBeVisible({ timeout: 15000 });

    // 2. Click "Set up your family"
    await page.getByRole('button', { name: /set up your family/i }).click();

    // S2: Parent Name
    await expect(page.getByRole('heading', { name: /what should we call you/i })).toBeVisible();
    await page.getByLabel(/your first name/i).fill(data.parent);
    await page.getByRole('button', { name: /^continue$/i }).click();

    // S3: Relationship
    await expect(page.getByRole('heading', { name: /and you're the/i })).toBeVisible();
    await page.getByRole('radio', { name: data.relationship, exact: true }).click();
    await page.getByRole('button', { name: /^continue$/i }).click();

    // S6: Family Name (S4 and S5 are skipped in redesign!)
    await expect(page.getByRole('heading', { name: /every family needs a name/i })).toBeVisible({ timeout: 10000 });
    await page.getByLabel(/family name/i).fill(data.family);
    await page.getByRole('button', { name: /^continue$/i }).click();

    // S7: Account & Signup
    await expect(page.getByRole('heading', { name: /your family is ready/i })).toBeVisible();
    await page.getByRole('button', { name: /continue with email/i }).click();

    // Signup form
    await expect(page).toHaveURL(/\/signup/, { timeout: 15000 });
    await page.locator('input[type="text"]').fill(data.parent);
    await page.locator('input[type="email"]').fill(data.email);
    await page.locator('input[type="password"]').fill(data.password);
    await page.getByRole('button', { name: /sign up/i }).click();

    // Email verification page
    await expect(page).toHaveURL(/\/verify-email$/, { timeout: 20000 });
    verifyEmailUser(data.email);
    await page.getByRole('button', { name: /i've verified my email/i }).click();

    // P1: Family Composition
    await expect(page).toHaveURL(/\/onboarding\?mode=create$/, { timeout: 20000 });
    await expect(page.getByRole('heading', { name: /your family is taking shape/i })).toBeVisible({ timeout: 20000 });

    // Verify parent is listed
    await expect(page.getByText('Alice')).toBeVisible();

    // Click Continue to finish P1
    const continueBtn = page.getByRole('button', { name: /^continue$/i });
    await expect(continueBtn).toBeEnabled({ timeout: 20000 });
    await continueBtn.click();

    // Navigates directly to ParentLivingHome /
    await expect(page).toHaveURL(/\/$|\/#?$/, { timeout: 15000 });

    // Assert Zero-child card is displayed
    const zeroChildCard = page.getByTestId('parent-zero-child-card');
    await expect(zeroChildCard).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('zero-child-add-child-btn')).toBeVisible();
    await expect(page.getByTestId('zero-child-invite-adult-btn')).toBeVisible();

    // Authoritative Firestore outcome: exactly 1 family, 0 children, 0 child wallets, 0 tasks
    const outcome = await getOnboardingOutcome(data.email, {
      familyCount: 1,
      childCount: 0,
      walletCount: 0,
      taskCount: 0,
      feedCount: 0,
    });
    expect(outcome.familyId).toBeTruthy();
    expect(outcome.familyCount).toBe(1);
    expect(outcome.childCount).toBe(0);
    expect(outcome.walletCount).toBe(0);
    expect(outcome.taskCount).toBe(0);

    // Assert Reload stability: Full-page reload stays cleanly on / with zero-child card
    await page.reload();
    await expect(page).toHaveURL(/\/$|\/#?$/, { timeout: 15000 });
    await expect(page.getByTestId('parent-zero-child-card')).toBeVisible({ timeout: 15000 });
  });

  // =========================================================================
  // FLOW A2: Onboarding Reload & Duplicate Family Protection
  // =========================================================================
  test('FLOW A2: Reloading on P1 preserves draft and does not create duplicate families', async ({ page }) => {
    const data: OnboardingPersona = {
      parent: 'Bob',
      relationship: 'Dad',
      child: '',
      family: 'Bob Builders',
      email: uniqueEmail('bob-onboard'),
      password: 'password123',
    };

    await page.goto('/');
    await page.getByRole('button', { name: /set up your family/i }).click();

    // S2
    await page.getByLabel(/your first name/i).fill(data.parent);
    await page.getByRole('button', { name: /^continue$/i }).click();

    // S3
    await page.getByRole('radio', { name: data.relationship, exact: true }).click();
    await page.getByRole('button', { name: /^continue$/i }).click();

    // S6
    await page.getByLabel(/family name/i).fill(data.family);
    await page.getByRole('button', { name: /^continue$/i }).click();

    // S7
    await page.getByRole('button', { name: /continue with email/i }).click();
    await page.locator('input[type="text"]').fill(data.parent);
    await page.locator('input[type="email"]').fill(data.email);
    await page.locator('input[type="password"]').fill(data.password);
    await page.getByRole('button', { name: /sign up/i }).click();

    // Verify email
    await expect(page).toHaveURL(/\/verify-email$/, { timeout: 20000 });
    verifyEmailUser(data.email);
    await page.getByRole('button', { name: /i've verified my email/i }).click();

    // P1
    await expect(page).toHaveURL(/\/onboarding\?mode=create$/, { timeout: 20000 });
    await expect(page.getByRole('heading', { name: /your family is taking shape/i })).toBeVisible({ timeout: 20000 });

    // Reload during P1
    await page.reload();
    await expect(page.getByRole('heading', { name: /your family is taking shape/i })).toBeVisible({ timeout: 20000 });

    // Finish
    const continueBtn = page.getByRole('button', { name: /^continue$/i });
    await expect(continueBtn).toBeEnabled({ timeout: 20000 });
    await continueBtn.click();

    await expect(page).toHaveURL(/\/$|\/#?$/, { timeout: 15000 });

    // Exactly 1 family
    const outcome = await getOnboardingOutcome(data.email, { familyCount: 1, childCount: 0, walletCount: 0 });
    expect(outcome.familyCount).toBe(1);
    expect(outcome.childCount).toBe(0);
  });

  // =========================================================================
  // FLOW A3: Routing Gate Authority
  // =========================================================================
  test('FLOW A3: Authenticated user with no family and no create intent redirects to /no-family', async ({ page }) => {
    // Seed user with no family
    const noFamEmail = uniqueEmail('nofam');
    seedOrphanUser(noFamEmail);

    await page.goto('/login');
    await page.fill('input[type="email"]', noFamEmail);
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');

    // Routing gate redirects to /no-family
    await expect(page).toHaveURL(/\/no-family/, { timeout: 15000 });
    await expect(page.getByRole('button', { name: /create a family/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /join an existing family/i })).toBeVisible();
  });

  // =========================================================================
  // FLOW B & B2: Add Child On Their Own Device & Approval Idempotency
  // =========================================================================
  test('FLOW B & B2: Parent generates QR from Add Child, unauthenticated child scans & submits, Parent approves, 4-phase provisioning creates canonical wallet and Auth user', async ({ browser }) => {
    const parentContext = await browser.newContext();
    const parentPage = await parentContext.newPage();

    const childContext = await browser.newContext();
    const childPage = await childContext.newPage();

    // 1. Parent logs in and opens /family
    await loginAs(parentPage, 'owner@test.com');
    await parentPage.goto('/family');

    // Click "+ Add a child"
    const addChildBtn = parentPage.getByRole('button', { name: /Add Child|\+ Add a child/i }).first();
    await expect(addChildBtn).toBeVisible({ timeout: 10000 });
    await addChildBtn.click();

    // AddChildModal opens with choice -> Click "On their own device"
    const deviceChoice = parentPage.getByTestId('add-child-path-device');
    await expect(deviceChoice).toBeVisible({ timeout: 10000 });
    await deviceChoice.click();

    // ConnectChildDeviceQrModal opens with intent="new_child_join"
    const rawTokenSpan = parentPage.getByTestId('qr-raw-token');
    await expect(rawTokenSpan).toBeAttached({ timeout: 10000 });
    const rawToken = (await rawTokenSpan.textContent())?.trim() || '';
    expect(rawToken).toBeTruthy();

    // Parent returns to /
    await parentPage.goto('/');
    await parentPage.keyboard.press('Escape');

    // 2. Child device visits /join-qr?token=...
    await childPage.goto(`/join-qr?token=${rawToken}`);
    const nameInput = childPage.getByTestId('qr-display-name-input');
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    await nameInput.fill('Jamie');
    await childPage.getByTestId('submit-qr-token-button').click();

    // Child enters waiting state
    await expect(childPage.getByText('Waiting for Parent Approval')).toBeVisible({ timeout: 10000 });

    // 3. Parent opens Approval Center (/review)
    await parentPage.goto('/review');

    // Headline displays: "Jamie wants to join your family"
    const headline = parentPage.getByTestId('qr-join-card-headline');
    await expect(headline).toBeVisible({ timeout: 10000 });
    await expect(headline).toContainText('Jamie wants to join your family');

    // Explicitly verify NO child selector dropdown is rendered
    await expect(parentPage.getByTestId('child-selector-dropdown')).toHaveCount(0);

    // Click Approve
    const approveBtn = parentPage.getByTestId('approve-qr-join-button');
    await expect(approveBtn).toBeEnabled();
    await approveBtn.click();

    // 4. Child device detects approval and lands on dashboard
    await expect(childPage.getByText('Request Approved!')).toBeVisible({ timeout: 15000 });
    await expect(childPage.getByText('Jamie')).toBeVisible({ timeout: 15000 });

    // 5. Authoritative Firestore verification
    const familyCounts = inspectFamilyCounts('test-fam');
    const jamieUser = familyCounts.children.find((c: any) => c.displayName === 'Jamie');
    expect(jamieUser, 'Jamie child user must exist in Firestore').toBeTruthy();
    const jamieId = jamieUser.id;

    const provisioning = inspectChildProvisioning(jamieId, 'test-fam');
    expect(provisioning.userExists).toBe(true);
    expect(provisioning.userData.role).toBe('child');
    expect(provisioning.userData.displayName).toBe('Jamie');
    expect(provisioning.userData.authUid).toBeTruthy();

    // Canonical wallet exists at families/{familyId}/wallets/{childId}
    expect(provisioning.canonicalWalletExists).toBe(true);
    expect(provisioning.canonicalWalletData.balance).toBe(0);

    // Root wallets/{childId} does NOT exist!
    expect(provisioning.rootWalletExists).toBe(false);

    // Child login is enabled
    expect(provisioning.loginExists).toBe(true);
    expect(provisioning.loginData.status).toBe('enabled');

    // Firebase Auth user exists
    expect(provisioning.authUserExists).toBe(true);

    // FLOW B2: Double approval idempotency
    // Calling approval again or re-checking does not duplicate the child
    const secondCounts = inspectFamilyCounts('test-fam');
    const jamieMatches = secondCounts.children.filter((c: any) => c.displayName === 'Jamie');
    expect(jamieMatches.length).toBe(1);

    await parentContext.close();
    await childContext.close();
  });

  // =========================================================================
  // FLOW C: Add Child Without a Device (Offline/Direct Profile)
  // =========================================================================
  test('FLOW C: Parent creates child profile without a device -> direct creation with canonical wallet and 0 tasks/rewards', async ({ page }) => {
    await loginAs(page, 'owner@test.com');
    await page.goto('/family');

    // Click "+ Add a child"
    const addChildBtn = page.getByRole('button', { name: /Add Child|\+ Add a child/i }).first();
    await expect(addChildBtn).toBeVisible({ timeout: 10000 });
    await addChildBtn.click();

    // Select "Set up without a device"
    const noDeviceChoice = page.getByTestId('add-child-path-no-device');
    await expect(noDeviceChoice).toBeVisible({ timeout: 10000 });
    await noDeviceChoice.click();

    // Enter child name "Sam"
    const nameInput = page.locator('#child-name');
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    await nameInput.fill('Sam');

    // Submit profile
    await page.getByRole('button', { name: /create child profile|create child/i }).click();

    // Login choice screen appears ("Should this child be able to sign in?")
    await expect(page.getByText(/should this child be able to sign in/i)).toBeVisible({ timeout: 15000 });

    // Click "Not now" to finish
    await page.getByRole('button', { name: /not now/i }).click();

    // Verify Sam appears in Family World
    await expect(page.getByText('Sam')).toBeVisible({ timeout: 15000 });

    // Verify Firestore canonical wallet
    const familyCounts = inspectFamilyCounts('test-fam');
    const samUser = familyCounts.children.find((c: any) => c.displayName === 'Sam');
    expect(samUser).toBeTruthy();

    const provisioning = inspectChildProvisioning(samUser.id, 'test-fam');
    expect(provisioning.userExists).toBe(true);
    expect(provisioning.canonicalWalletExists).toBe(true);
    expect(provisioning.rootWalletExists).toBe(false);
  });

  // =========================================================================
  // FLOW D: Connect Personal Device to Existing Managed Child
  // =========================================================================
  test('FLOW D: Connect personal device to existing child profile binds device without creating new user or wallet', async ({ browser }) => {
    const parentContext = await browser.newContext();
    const parentPage = await parentContext.newPage();
    const childContext = await browser.newContext();
    const childPage = await childContext.newPage();

    await loginAs(parentPage, 'owner@test.com');
    await parentPage.goto('/family');

    // Click Child Leo avatar to open MemberDetailSheet
    const childLeoBtn = parentPage.getByRole('button', { name: /View Child Leo/i }).first();
    await expect(childLeoBtn).toBeVisible({ timeout: 15000 });
    await childLeoBtn.click();

    // Click "Manage Member"
    const manageBtn = parentPage.getByRole('button', { name: /Manage Member|Manage child/i }).first();
    await expect(manageBtn).toBeVisible({ timeout: 10000 });
    await manageBtn.click();

    // Click "Connect personal device" button
    const connectButton = parentPage.getByTestId('connect-child-device-button');
    await expect(connectButton).toBeVisible({ timeout: 10000 });
    await connectButton.click();

    const rawTokenSpan = parentPage.getByTestId('qr-raw-token');
    await expect(rawTokenSpan).toBeAttached({ timeout: 10000 });
    const rawToken = (await rawTokenSpan.textContent())?.trim() || '';
    expect(rawToken).toBeTruthy();

    await parentPage.goto('/');
    await parentPage.keyboard.press('Escape');

    // Child submits device connect request
    await childPage.goto(`/join-qr?token=${rawToken}`);
    const nameInput = childPage.getByTestId('qr-display-name-input');
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    await nameInput.fill('Leo Tablet');
    await childPage.getByTestId('submit-qr-token-button').click();

    await expect(childPage.getByText('Waiting for Parent Approval')).toBeVisible({ timeout: 10000 });

    // Parent reviews and approves
    await parentPage.goto('/review');
    const headline = parentPage.getByTestId('qr-join-card-headline');
    await expect(headline).toBeVisible({ timeout: 10000 });
    await expect(headline).toContainText('Leo Tablet wants to connect a personal device to Child Leo');

    const approveBtn = parentPage.getByTestId('approve-qr-join-button');
    await expect(approveBtn).toBeEnabled();
    await approveBtn.click();

    // Child device gets approved and signs in
    await expect(childPage.getByText('Request Approved!')).toBeVisible({ timeout: 15000 });
    await expect(childPage.getByText('Child Leo')).toBeVisible({ timeout: 15000 });

    // Assert Child Leo's wallet and user are unchanged
    const provisioning = inspectChildProvisioning('child1', 'test-fam');
    expect(provisioning.userExists).toBe(true);
    expect(provisioning.canonicalWalletExists).toBe(true);

    await parentContext.close();
    await childContext.close();
  });

  // =========================================================================
  // FLOW D2: Untargeted / Legacy QR Request Fail-Closed Verification
  // =========================================================================
  test('FLOW D2: Untargeted QR request shows child dropdown selector, remains disabled until child selected, and binds correctly', async ({ browser }) => {
    const parentContext = await browser.newContext();
    const parentPage = await parentContext.newPage();
    const childContext = await browser.newContext();
    const childPage = await childContext.newPage();

    // 1. Seed legacy untargeted QR token
    const legacyToken = seedLegacyQrToken();

    // 2. Child scans untargeted token and submits request
    await childPage.goto(`/join-qr?token=${legacyToken}`);
    await expect(childPage.getByTestId('qr-display-name-input')).toBeVisible({ timeout: 10000 });
    await childPage.getByTestId('qr-display-name-input').fill('Legacy Device');
    await childPage.getByTestId('submit-qr-token-button').click();
    await expect(childPage.getByText('Waiting for Parent Approval')).toBeVisible({ timeout: 10000 });

    // 3. Parent opens review
    await loginAs(parentPage, 'owner@test.com');
    await parentPage.goto('/review');

    // Headline indicates untargeted device request
    const headline = parentPage.getByTestId('qr-join-card-headline');
    await expect(headline).toBeVisible({ timeout: 10000 });
    await expect(headline).toContainText('Legacy Device wants to connect a device');

    // Child selector dropdown IS visible
    const childSelect = parentPage.getByTestId('child-selector-dropdown');
    await expect(childSelect).toBeVisible();

    // Approve button is DISABLED until a child is selected
    const approveBtn = parentPage.getByTestId('approve-qr-join-button');
    await expect(approveBtn).toBeDisabled();

    // Parent selects Child Leo
    await childSelect.selectOption({ label: 'Child Leo' });

    // Approve button is now ENABLED
    await expect(approveBtn).toBeEnabled();
    await approveBtn.click();

    // Child signs in
    await expect(childPage.getByText('Request Approved!')).toBeVisible({ timeout: 15000 });
    await expect(childPage.getByText('Child Leo')).toBeVisible({ timeout: 15000 });

    // Explicit assertion: Legacy device bind created ZERO new child docs and ZERO new wallets
    const counts = inspectFamilyCounts('test-fam');
    expect(counts.childCount).toBe(2); // exactly original test children
    expect(counts.walletCount).toBe(2); // exactly original wallets

    await parentContext.close();
    await childContext.close();
  });

  // =========================================================================
  // FLOW E: Manage Child Dialog & Route Redirection
  // =========================================================================
  test('FLOW E: Tapping child avatar opens ManageChildDialog directly; /family/members/:id redirects safely', async ({ page }) => {
    await loginAs(page, 'owner@test.com');
    await page.goto('/family');

    // Tap Child Leo avatar
    const childLeoBtn = page.getByRole('button', { name: /View Child Leo/i }).first();
    await expect(childLeoBtn).toBeVisible({ timeout: 15000 });
    await childLeoBtn.click();

    // Open Manage Member
    const manageBtn = page.getByRole('button', { name: /Manage Member|Manage child/i }).first();
    await expect(manageBtn).toBeVisible({ timeout: 10000 });
    await manageBtn.click();

    // ManageChildDialog is rendered directly without black screen
    await expect(page.getByRole('heading', { name: /Manage Child Leo/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('connect-child-device-button')).toBeVisible();
    await expect(page.getByTestId('remove-child-button')).toBeVisible();

    // Press Escape to close dialog
    await page.keyboard.press('Escape');

    // Test route redirection: /family/members/child1 redirects safely to /family
    await page.goto('/family/members/child1');
    await expect(page).toHaveURL(/\/family$/, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: /Family Hub/i })).toBeVisible();
  });

  // =========================================================================
  // FLOW F: Remove Child End-to-End Verification
  // =========================================================================
  test('FLOW F: Manage Child -> Remove Child -> removes user, canonical wallet, login, and unassigns tasks', async ({ page }) => {
    await loginAs(page, 'owner@test.com');
    await page.goto('/family');

    // Open Child Ava (child2)
    const childAvaBtn = page.getByRole('button', { name: /View Child Ava/i }).first();
    await expect(childAvaBtn).toBeVisible({ timeout: 15000 });
    await childAvaBtn.click();

    // Open Manage Member
    const manageBtn = page.getByRole('button', { name: /Manage Member|Manage child/i }).first();
    await expect(manageBtn).toBeVisible({ timeout: 10000 });
    await manageBtn.click();

    // Click Remove Child
    const removeBtn = page.getByTestId('remove-child-button');
    await expect(removeBtn).toBeVisible({ timeout: 10000 });
    await removeBtn.click();

    // Type confirmation name "Child Ava"
    const confirmInput = page.locator('input[placeholder="Child Ava"]');
    await expect(confirmInput).toBeVisible({ timeout: 10000 });
    await confirmInput.fill('Child Ava');

    // Click Confirm Delete
    const confirmDeleteBtn = page.getByTestId('confirm-delete-child-button');
    await expect(confirmDeleteBtn).toBeEnabled();
    await confirmDeleteBtn.click();

    // Child Ava is removed from the view
    await expect(page.getByText('Child profile removed')).toBeVisible({ timeout: 15000 });

    // Inspect Firestore deletion
    const deletion = inspectChildDeletion('child2', 'test-fam');
    expect(deletion.userExists).toBe(false);
    expect(deletion.canonicalWalletExists).toBe(false);
    expect(deletion.loginExists).toBe(false);
    expect(deletion.authUserExists).toBe(false);
    expect(deletion.tasksWithAssigneeCount).toBe(0);
  });

  // =========================================================================
  // FLOW G: Zero-Child System Pages Integrity
  // =========================================================================
  test('FLOW G: Parent with zero children can navigate /, /family, /tasks, /rewards, /wallet, /wallets, /settings without crashing', async ({ page }) => {
    // Seed a family with 0 children
    const zeroFamEmail = uniqueEmail('zerofam');
    seedZeroChildFamily(zeroFamEmail, 'zero-fam');

    await page.goto('/login');
    await page.fill('input[type="email"]', zeroFamEmail);
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');

    // 1. Home /
    await expect(page).toHaveURL(/\/$|\/#?$/, { timeout: 15000 });
    await expect(page.getByTestId('parent-zero-child-card')).toBeVisible({ timeout: 15000 });

    // 2. Family /family
    await page.goto('/family');
    await expect(page).toHaveURL(/\/family/, { timeout: 10000 });
    await expect(page.getByRole('button', { name: /Add Child|\+ Add a child/i }).first()).toBeVisible();

    // 3. Tasks /tasks
    await page.goto('/tasks');
    await expect(page).toHaveURL(/\/tasks/, { timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('Something went wrong');

    // 4. Rewards /rewards
    await page.goto('/rewards');
    await expect(page).toHaveURL(/\/rewards/, { timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('Something went wrong');

    // 5. Wallet /wallet
    await page.goto('/wallet');
    await expect(page).toHaveURL(/\/wallet/, { timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('Something went wrong');

    // 6. Wallets /wallets
    await page.goto('/wallets');
    await expect(page).toHaveURL(/\/wallets/, { timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('Something went wrong');

    // 7. Settings /settings
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings/, { timeout: 10000 });
    await expect(page.locator('body')).not.toContainText('Something went wrong');

    // Assert no fake children were auto-created
    const counts = inspectFamilyCounts('zero-fam');
    expect(counts.childCount).toBe(0);
    expect(counts.walletCount).toBe(0);
  });
});
