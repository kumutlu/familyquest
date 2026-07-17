const fs = require('fs');
const path = 'tests/e2e/approval.spec.ts';
let s = fs.readFileSync(path, 'utf8');

const append = `

  test('Money Request: child requests from parent, parent approves (balance + ledger + history)', async ({ page }) => {
    // 1. Child requests £2.00 from the parent
    await loginAs(page, 'child@test.com');
    await page.click('a[href="/wallets"]');
    await page.getByRole('button', { name: /request money/i }).click();
    await page.locator('select').selectOption({ label: /Parent Dad/ });
    await page.fill('input[type="number"]', '2');
    await page.getByRole('button', { name: /send request/i }).click();
    // Request sent confirmation
    await expect(page.getByText(/request sent/i)).toBeVisible({ timeout: 5000 });
    await logout(page);

    // 2. Parent sees it in Pending and approves
    await loginAs(page, 'parent@test.com');
    await expect(page.locator('text="Money Request"').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/Child Leo requested/)).toBeVisible();
    // No raw permission-denied message
    await expect(page.locator(/permission-denied/i)).not.toBeVisible();
    await page.getByRole('button', { name: 'Approve' }).first().click();
    // Leaves Pending
    await expect(page.locator(/Child Leo requested/)).not.toBeVisible();
    // History shows approved
    await page.getByRole('button', { name: 'History' }).click();
    await expect(page.locator(/Child Leo requested/)).toBeVisible();
    await expect(page.getAllByText('Approved').length).toBeGreaterThan(0);
    await logout(page);

    // 3. Child balance increased by £2.00 (was 500 -> 700)
    await loginAs(page, 'child@test.com');
    await page.click('a[href="/wallets"]');
    await expect(page.getByText(/£7\.00/).first()).toBeVisible({ timeout: 5000 });
  });

  test('Money Request: child requests from parent, parent rejects (no balance movement)', async ({ page }) => {
    await loginAs(page, 'child@test.com');
    await page.click('a[href="/wallets"]');
    await page.getByRole('button', { name: /request money/i }).click();
    await page.locator('select').selectOption({ label: /Parent Dad/ });
    await page.fill('input[type="number"]', '3');
    await page.getByRole('button', { name: /send request/i }).click();
    await expect(page.getByText(/request sent/i)).toBeVisible({ timeout: 5000 });
    await logout(page);

    await loginAs(page, 'parent@test.com');
    await expect(page.locator('text="Money Request"').first()).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: 'Reject' }).first().click();
    await expect(page.locator(/Child Leo requested/)).not.toBeVisible();
    await page.getByRole('button', { name: 'History' }).click();
    await expect(page.locator(/Child Leo requested/)).toBeVisible();
    await expect(page.getAllByText('Rejected').length).toBeGreaterThan(0);
    await logout(page);

    // Child balance unchanged (500)
    await loginAs(page, 'child@test.com');
    await page.click('a[href="/wallets"]');
    await expect(page.getByText(/£5\.00/).first()).toBeVisible({ timeout: 5000 });
  });
`;

if (!s.includes('Money Request: child requests from parent')) {
  s = s.replace(/}\);\s*$/, '});\n' + append);
  fs.writeFileSync(path, s);
  console.log('appended e2e money request tests');
} else {
  console.log('e2e tests already present');
}
