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

    // 1. Parent/Owner logs in & opens "Connect Child Device" modal via Manage Child
    await loginAs(parentPage, 'owner@test.com');
    await parentPage.goto('/family');

    // Click Child Leo avatar to open MemberDetailSheet
    const childLeoBtn = parentPage.getByRole('button', { name: /View Child Leo/i }).first();
    await expect(childLeoBtn).toBeVisible({ timeout: 15000 });
    await childLeoBtn.click();

    // Click "Manage Member" in MemberDetailSheet
    const manageBtn = parentPage.getByRole('button', { name: /Manage Member|Manage child/i }).first();
    await expect(manageBtn).toBeVisible({ timeout: 10000 });
    await manageBtn.click();

    // In ManageChildDialog, click "Connect personal device" button
    const connectButton = parentPage.getByTestId('connect-child-device-button');
    await expect(connectButton).toBeVisible({ timeout: 10000 });
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

    // Track if old request ID is ever polled
    let oldRequestPollCalled = false;
    await childPage.route('**/getChildQrJoinStatus', async (route) => {
      try {
        const postData = route.request().postDataJSON?.();
        if (postData?.data?.requestId === 'old-stale-request-id') {
          oldRequestPollCalled = true;
        }
      } catch {
        /* ignore parsing error */
      }
      await route.continue();
    });

    // Seed child browser localStorage with an OLD pending QR handle BEFORE scanning new QR
    await childPage.goto('/login');
    await childPage.evaluate(() => {
      localStorage.setItem('queki.childQrJoinRequest', JSON.stringify({
        requestId: 'old-stale-request-id',
        requestSecret: 'old-stale-secret',
      }));
    });

    // 2. Child device opens direct QR URL /join-qr?token=... (simulating camera QR scan on unauthenticated device)
    await childPage.goto(`/join-qr?token=${cleanToken}`);

    // Assert explicitly: OLD_REQUEST_POLL_CALLED=false
    expect(oldRequestPollCalled).toBe(false);

    await expect(childPage.getByTestId('qr-display-name-input')).toBeVisible();

    // Assert stale handle was cleared from storage upon fresh token scan
    const storedHandle = await childPage.evaluate(() => localStorage.getItem('queki.childQrJoinRequest'));
    expect(storedHandle).toBeNull();

    await childPage.getByTestId('qr-display-name-input').fill('Ali');
    await expect(childPage.getByTestId('submit-qr-token-button')).toBeVisible();
    await childPage.getByTestId('submit-qr-token-button').click();

    // 3. Child enters "Waiting for Parent Approval" state
    await expect(childPage.getByText('Waiting for Parent Approval')).toBeVisible({ timeout: 10000 });
    await expect(childPage.getByTestId('scan-another-qr-button')).toBeVisible();

    // Verify reloading/navigating to child page restores waiting status from local storage
    await childPage.goto('/join-qr');
    await expect(childPage.getByText('Waiting for Parent Approval')).toBeVisible({ timeout: 10000 });

    // 4. Parent device (already open on /) receives notification & pending approval indication WITHOUT reload
    // Open NotificationCenter bell
    const bellButton = parentPage.getByRole('button', { name: /notification/i }).first();
    await expect(bellButton).toBeVisible({ timeout: 10000 });
    await bellButton.click();

    // Click THE notification item "Ali wants to connect a device"
    const notifRow = parentPage.getByRole('button', { name: /Ali wants to connect a device/i }).first();
    await expect(notifRow).toBeVisible({ timeout: 10000 });
    await notifRow.click();

    // /review opens
    await expect(parentPage).toHaveURL(/\/review/);

    // Explicitly assert:
    // REVIEW_ZERO_COUNT_VISIBLE = false
    // ALL_CAUGHT_UP_VISIBLE = false
    await expect(parentPage.getByTestId('review-count')).not.toBeVisible();
    await expect(parentPage.getByTestId('swipe-review-caught-up')).not.toBeVisible();

    // Approval Center displays "Ali wants to connect a personal device to Child Leo"
    const qrHeadline = parentPage.getByTestId('qr-join-card-headline');
    await expect(qrHeadline).toBeVisible({ timeout: 10000 });
    await expect(qrHeadline).toContainText('Ali wants to connect a personal device to Child Leo');

    const qrDevice = parentPage.getByTestId('qr-join-card-device');
    await expect(qrDevice).toBeVisible({ timeout: 10000 });
    await expect(qrDevice).toContainText('Waiting for approval');

    // Click Approve
    const approveBtn = parentPage.getByTestId('approve-qr-join-button');
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
