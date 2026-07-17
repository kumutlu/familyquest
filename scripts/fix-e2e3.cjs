const fs = require('fs');
const path = 'tests/e2e/approval.spec.ts';
let s = fs.readFileSync(path, 'utf8');

// Replace the two money-request e2e tests with versions that exercise the
// seeded pending money request through the Approval Center (the exact flow the
// bug fix targets: parent approves/rejects without permission-denied).
const start = s.indexOf("  test('Money Request: child requests from parent");
const end = s.indexOf('  test(\'Pet Box Approval\'');
if (start === -1 || end === -1) {
  console.error('could not locate money request test block');
  process.exit(1);
}

const replacement = `  test('Money Request: parent approves a pending request (balance + ledger + history)', async ({ page }) => {
    // Parent sees the seeded pending money request in the Approval Center
    await loginAs(page, 'parent@test.com');
    await expect(page.locator('text="Money Request"').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/Child Leo requested/)).toBeVisible();
    // No raw permission-denied message is ever shown
    await expect(page.locator(/permission-denied/i)).not.toBeVisible();
    // Approve (not Accept) is the actionable button for a 'pending' request
    await page.getByRole('button', { name: 'Approve' }).first().click();
    // Leaves Pending
    await expect(page.getByText(/Child Leo requested/)).not.toBeVisible();
    // History shows approved
    await page.getByRole('button', { name: 'History' }).click();
    await expect(page.getByText(/Child Leo requested/)).toBeVisible();
    await expect(page.getAllByText('Approved').length).toBeGreaterThan(0);
    await logout(page);

    // Child balance increased by £2.00 (was 500 -> 700)
    await loginAs(page, 'child@test.com');
    await page.click('a[href="/wallet"]');
    await expect(page.getByText(/£7\\.00/).first()).toBeVisible({ timeout: 5000 });
  });

  test('Money Request: parent rejects a pending request (no balance movement)', async ({ page }) => {
    await loginAs(page, 'parent@test.com');
    await expect(page.locator('text="Money Request"').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/Child Leo requested/)).toBeVisible();
    await page.getByRole('button', { name: 'Reject' }).first().click();
    await expect(page.getByText(/Child Leo requested/)).not.toBeVisible();
    await page.getByRole('button', { name: 'History' }).click();
    await expect(page.getByText(/Child Leo requested/)).toBeVisible();
    await expect(page.getAllByText('Rejected').length).toBeGreaterThan(0);
    await logout(page);

    // Child balance unchanged (500)
    await loginAs(page, 'child@test.com');
    await page.click('a[href="/wallet"]');
    await expect(page.getByText(/£5\\.00/).first()).toBeVisible({ timeout: 5000 });
  });

`;

s = s.slice(0, start) + replacement + s.slice(end);
fs.writeFileSync(path, s);
console.log('rewrote money request e2e tests to use seeded data');
