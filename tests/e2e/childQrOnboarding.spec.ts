import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { loginAs, logout } from './utils/auth';

test.describe('Child QR Device Onboarding E2E Flow', () => {
  test.beforeEach(async () => {
    execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
  });

  test('Parent generates QR, Child scans & requests, Parent approves, Child signs in', async ({ browser }) => {
    // Parent context
    const parentContext = await browser.newContext();
    const parentPage = await parentContext.newPage();

    // Child context (unauthenticated device)
    const childContext = await browser.newContext();
    const childPage = await childContext.newPage();

    // 1. Parent logs in & opens "Connect Child Device" modal
    await loginAs(parentPage, 'parent@test.com');
    await parentPage.click('a[href="/family"]');

    // Click "Connect Child Device" button
    const connectButton = parentPage.getByRole('button', { name: /Connect Child Device/i }).first();
    await expect(connectButton).toBeVisible();
    await connectButton.click();

    // Modal opens, click "Generate QR Code"
    const generateBtn = parentPage.getByTestId('generate-qr-button');
    await expect(generateBtn).toBeVisible();
    await generateBtn.click();

    // QR modal displays active QR token / copy link
    const copyBtn = parentPage.getByTestId('copy-qr-link-button');
    await expect(copyBtn).toBeVisible({ timeout: 10000 });

    // Read the join URL or raw token
    const tokenDisplay = parentPage.getByTestId('qr-raw-token');
    await expect(tokenDisplay).toBeVisible();
    const qrTokenText = await tokenDisplay.textContent();
    expect(qrTokenText).toBeTruthy();
    const cleanToken = qrTokenText?.trim() || '';

    // 2. Child device opens /join-qr and pastes QR token
    await childPage.goto('/join-qr');
    await expect(childPage.getByTestId('qr-token-input')).toBeVisible();

    await childPage.getByTestId('qr-token-input').fill(cleanToken);
    await childPage.getByTestId('submit-qr-token-button').click();

    // 3. Child enters "Waiting for Parent Approval" state
    await expect(childPage.getByText('Waiting for Parent Approval')).toBeVisible({ timeout: 10000 });

    // Verify reloading child page restores waiting status from local storage
    await childPage.reload();
    await expect(childPage.getByText('Waiting for Parent Approval')).toBeVisible({ timeout: 10000 });

    // 4. Parent opens Approval Center and sees Child Device Join Request
    await parentPage.click('a[href="/"]'); // Navigate to Dashboard / Approval Center
    const qrRequestCard = parentPage.locator('div', { hasText: 'Child Device Join Request' }).first();
    await expect(qrRequestCard).toBeVisible({ timeout: 10000 });

    // Select existing managed child profile
    const childSelect = qrRequestCard.getByTestId('child-selector-dropdown');
    await expect(childSelect).toBeVisible();
    await childSelect.selectOption({ label: 'Child Leo' });

    // Click Approve & Bind
    const approveBtn = qrRequestCard.getByTestId('approve-qr-join-button');
    await expect(approveBtn).toBeEnabled();
    await approveBtn.click();

    // 5. Child device detects approval, exchanges custom token, and lands on child dashboard
    await expect(childPage.getByText('Request Approved!')).toBeVisible({ timeout: 15000 });

    // Wait for redirect to child dashboard / main shell
    await expect(childPage.getByText('Child Leo')).toBeVisible({ timeout: 15000 });

    await parentContext.close();
    await childContext.close();
  });
});
