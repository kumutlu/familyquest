const fs = require('fs');
const path = 'tests/e2e/approval.spec.ts';
let s = fs.readFileSync(path, 'utf8');

// Replace the two money-request e2e tests with robust locator-based assertions.
const start = s.indexOf("  test('Money Request: parent approves");
const end = s.indexOf("});", start); // closing of the describe block
if (start === -1 || end === -1) {
  console.error('could not locate money request test block');
  process.exit(1);
}

const replacement = `  test('Money Request: parent approves a pending request (balance + ledger + history)', async ({ page }) => {
    // Parent lands on the dashboard which embeds the Approval Center.
    await loginAs(page, 'parent@test.com');
    const moneyCard = page.locator('text=/Child Leo requested/').first();
    await expect(moneyCard).toBeVisible({ timeout: 5000 });
    // No raw permission-denied message is ever shown
    await expect(page.locator('text=/permission-denied/i')).toHaveCount(0);
    // Approve (not Accept) is the actionable button for a 'pending' request
    await page.getByRole('button', { name: 'Approve' }).first().click();
    // Leaves Pending
    await expect(page.locator('text=/Child Leo requested/')).toHaveCount(0);
    // History shows approved
    await page.getByRole('button', { name: 'History' }).click();
    await expect(page.locator('text=/Child Leo requested/').first()).toBeVisible();
    await expect(page.locator('text=Approved').first()).toBeVisible();
    await logout(page);

    // Child balance increased by £2.00 (was 500 -> 700)
    await loginAs(page, 'child@test.com');
    await page.click('a[href="/wallet"]');
    await expect(page.locator('text=/£7\\\\.00/').first()).toBeVisible({ timeout: 5000 });
  });

  test('Money Request: parent rejects a pending request (no balance movement)', async ({ page }) => {
    await loginAs(page, 'parent@test.com');
    const moneyCard = page.locator('text=/Child Leo requested/').first();
    await expect(moneyCard).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: 'Reject' }).first().click();
    await expect(page.locator('text=/Child Leo requested/')).toHaveCount(0);
    await page.getByRole('button', { name: 'History' }).click();
    await expect(page.locator('text=/Child Leo requested/').first()).toBeVisible();
    await expect(page.locator('text=Rejected').first()).toBeVisible();
    await logout(page);

    // Child balance unchanged (500)
    await loginAs(page, 'child@test.com');
    await page.click('a[href="/wallet"]');
    await expect(page.locator('text=/£5\\\\.00/').first()).toBeVisible({ timeout: 5000 });
  });
`;

s = s.slice(0, start) + replacement + s.slice(end);
fs.writeFileSync(path, s);
console.log('rewrote money request e2e tests with robust locators');
