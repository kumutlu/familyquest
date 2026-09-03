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

    // 1. Parent/Owner logs in & opens "Connect Child Device" modal
    await loginAs(parentPage, 'owner@test.com');
    await parentPage.goto('/family');

    // Click "Connect Child Device" button
    const connectButton = parentPage.getByRole('button', { name: /Connect Child Device/i }).first();
    await expect(connectButton).toBeVisible();
    await connectButton.click();

    // Modal opens and auto-generates active QR token / copy link
    const copyBtn = parentPage.getByTestId('copy-join-link-button');
    await expect(copyBtn).toBeVisible({ timeout: 10000 });

    // Read the join URL or raw token
    const tokenDisplay = parentPage.getByTestId('qr-raw-token');
    await expect(tokenDisplay).toBeAttached();
    const qrTokenText = await tokenDisplay.textContent();
    expect(qrTokenText).toBeTruthy();
    const cleanToken = qrTokenText?.trim() || '';

    // Navigate parent back to home dashboard BEFORE child submits
    await parentPage.goto('/');
    await parentPage.keyboard.press('Escape'); // Close modal if open

    // 2. Child device opens direct QR URL /join-qr?token=... (simulating camera QR scan on unauthenticated device)
    await childPage.goto(`/join-qr?token=${cleanToken}`);
    await expect(childPage.getByTestId('qr-display-name-input')).toBeVisible();
    await childPage.getByTestId('qr-display-name-input').fill('Ali');
    await expect(childPage.getByTestId('submit-qr-token-button')).toBeVisible();
    await childPage.getByTestId('submit-qr-token-button').click();

    // 3. Child enters "Waiting for Parent Approval" state
    await expect(childPage.getByText('Waiting for Parent Approval')).toBeVisible({ timeout: 10000 });

    // Verify reloading child page restores waiting status from local storage
    await childPage.reload();
    await expect(childPage.getByText('Waiting for Parent Approval')).toBeVisible({ timeout: 10000 });

    // 4. Parent device (already open on /) reactively receives pending approval indication WITHOUT reload
    const pendingPriorityCard = parentPage.getByTestId('priority-approvals');
    await expect(pendingPriorityCard).toBeVisible({ timeout: 10000 });

    const reviewCta = parentPage.getByTestId('review-cta').first();
    await expect(reviewCta).toBeVisible({ timeout: 10000 });
    await reviewCta.click();

    // Approval Center opens, displays "Ali wants to connect a device"
    const qrHeadline = parentPage.getByTestId('qr-join-card-headline');
    await expect(qrHeadline).toBeVisible({ timeout: 10000 });
    await expect(qrHeadline).toContainText('Ali wants to connect a device');

    const qrDevice = parentPage.getByTestId('qr-join-card-device');
    await expect(qrDevice).toBeVisible({ timeout: 10000 });
    await expect(qrDevice).toContainText('Waiting for approval');

    const qrRequestCard = parentPage.locator('div', { hasText: 'Ali wants to connect a device' }).first();

    // Select existing managed child profile "Child Leo"
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
