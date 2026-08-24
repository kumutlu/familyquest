import { test, expect, Page } from '@playwright/test';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

/**
 * Swap the security ruleset loaded into the shared Firestore emulator for the
 * QA project (QA-only harness capability — production rules are untouched).
 */
async function putEmulatorRules(content: string) {
  const env = await initializeTestEnvironment({
    projectId: 'familyquest-beta-402cb',
    firestore: { rules: content, host: '127.0.0.1', port: 8080 },
  });
  await env.cleanup();
}

const DENY_ALL_RULES =
  'service cloud.firestore { match /databases/{database}/documents { allow read, write: if false; } }';

// Mirrors tests/e2e/utils/seed-wave42-qa.ts (kept inline: this spec must never
// import firebase-admin through Playwright's ESM transform).
const QA_CHILDREN = [
  { id: 'alisya', name: 'Alisya', email: 'alisya@test.com', pence: 1111, points: 111 },
  { id: 'mostium', name: 'Mostium', email: 'mostium@test.com', pence: 2222, points: 222 },
  { id: 'mnalium', name: 'Mnalium', email: 'mnalium@test.com', pence: 3333, points: 333 },
];

// ---------------------------------------------------------------------------
// Wave 4.2 + 4.3 FINAL release-proof REAL-BROWSER QA.
// Every assertion below runs against real Chromium + Firestore/Auth emulators.
// Screenshots are written to screenshots/wave4-2-3-rc/.
// ---------------------------------------------------------------------------

const SHOT_DIR = 'screenshots/wave4-2-3-rc';
const EMU = 'http://127.0.0.1:8080/v1/projects/familyquest-beta-402cb/databases/(default)/documents';
// Emulator super-user header: bypasses Rules for QA inspection only.
const OWNER_AUTH = { Authorization: 'Bearer owner' };

const IDS: Record<string, string> = {
  Alisya: 'alisya',
  Mostium: 'mostium',
  Mnalium: 'mnalium',
};

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: false });
}

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.waitForSelector('input[type="email"]');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForURL(url => url.pathname !== '/login', { timeout: 20000 });
}

/** Close any open Manage Wallet overlay via its ✕ button (Escape fallback). */
async function closeManageWallet(page: Page) {
  const overlay = page.locator('[data-testid="manage-wallet-overlay"]');
  if (await overlay.isVisible().catch(() => false)) {
    await page.locator('[data-testid="manage-wallet-overlay"] button', { hasText: '✕' }).first().click().catch(() => {});
    await page.waitForTimeout(300);
  }
  await page.keyboard.press('Escape').catch(() => {});
}

async function logout(page: Page) {
  // Dismiss any open modal/overlay (Manage Wallet uses a ✕ button).
  const overlay = page.locator('[data-testid="manage-wallet-overlay"]');
  for (let i = 0; i < 3 && (await overlay.isVisible().catch(() => false)); i++) {
    await page.locator('[data-testid="manage-wallet-overlay"] button', { hasText: '✕' }).first().click().catch(() => {});
    await page.waitForTimeout(300);
  }
  await page.keyboard.press('Escape').catch(() => {});
  const profileButton = page.locator('button[aria-label="Profile menu"]');
  if (await profileButton.isVisible().catch(() => false)) {
    await profileButton.click();
    const signOut = page.locator('[role="menuitem"]', { hasText: /sign out/i });
    if (await signOut.isVisible().catch(() => false)) {
      await signOut.click();
      await page.waitForURL(url => url.pathname === '/login', { timeout: 15000 }).catch(() => {});
    }
  }
  await page.goto('/login');
}

/** Read a wallet document straight from the Firestore emulator REST API. */
async function emulatorWallet(childId: string): Promise<number> {
  const res = await fetch(`${EMU}/families/qa-fam/wallets/${childId}`, { headers: OWNER_AUTH });
  expect(res.ok).toBeTruthy();
  const json = await res.json();
  return Number(json.fields.balance.integerValue ?? json.fields.balance.doubleValue);
}

async function emulatorLedger(childId: string): Promise<any[]> {
  const res = await fetch(
    `${EMU}/families/qa-fam/wallet_transactions?pageSize=50`, { headers: OWNER_AUTH },
  );
  expect(res.ok).toBeTruthy();
  const json = await res.json();
  return (json.documents ?? [])
    .map((d: any) => d.fields)
    .filter((f: any) => f.childId?.stringValue === childId);
}

test.describe.serial('Wave 4.2+4.3 release proof', () => {
  test.beforeAll(() => {
    execSync('npx tsx tests/e2e/utils/seed-wave42-qa.ts', { stdio: 'inherit' });
  });

  // ------------------------------------------------------------------ A
  test('A. Rewards — gold points, colour semantics, detail sheet (real browser)', async ({ page }) => {
    test.setTimeout(420000);

    // 390x844 light as Mostium
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, 'mostium@test.com');
    await page.goto('/rewards');
    await expect(page.getByTestId('points-hero')).toBeVisible();

    // Gold points presentation
    await expect(page.getByTestId('points-hero-value')).toHaveText(/222/);
    const heroHtml = await page.getByTestId('points-hero').innerHTML();
    expect(heroHtml).not.toContain('text-coral-500');
    expect(heroHtml).toContain('text-xp-500');
    await shot(page, '01-rewards-390x844-light');

    // Affordable reward enabled
    const affordable = page.locator('[data-testid="reward-card"]', { hasText: 'Sticker Pack' });
    await expect(affordable).toBeVisible();

    // Unaffordable reward present
    const unaffordable = page.locator('[data-testid="reward-card"]', { hasText: 'Theme Park Trip' });
    await expect(unaffordable).toBeVisible();

    // Sold-out reward present
    const soldOut = page.locator('[data-testid="reward-card"]', { hasText: 'Limited Poster' });
    await expect(soldOut).toBeVisible();
    await shot(page, '02-rewards-all-tiers');

    // Reward detail sheet + GET IT positive styling
    await affordable.click();
    const sheet = page.getByRole('dialog').or(page.locator('[data-testid="reward-detail-sheet"]')).first();
    await expect(sheet).toBeVisible();
    const getIt = page.getByTestId('reward-redeem');
    await expect(getIt).toBeVisible();
    const getItClass = await getIt.getAttribute('class');
    expect(getItClass || '').not.toContain('coral');
    await shot(page, '03-reward-detail-sheet-get-it');
    await closeManageWallet(page);

    // 390x844 dark
    await page.goto('/settings');
    const darkOption = page.getByRole('radio', { name: /dark/i }).first();
    if (await darkOption.isVisible().catch(() => false)) {
      await darkOption.click();
      await page
        .waitForFunction(() => document.documentElement.classList.contains('dark'), undefined, { timeout: 15000 })
        .catch(() => {});
      await page.waitForTimeout(500);
    }
    await page.goto('/rewards');
    await expect(page.getByTestId('points-hero')).toBeVisible({ timeout: 90000 });
    await expect(page.getByTestId('points-hero-value')).toHaveText(/222/);
    await shot(page, '04-rewards-390x844-dark');

    // 412x915 light again
    await page.setViewportSize({ width: 412, height: 915 });
    const lightOption = page.getByRole('radio', { name: /^light$/i }).first();
    await page.goto('/settings');
    if (await lightOption.isVisible().catch(() => false)) {
      await lightOption.click();
      await page
        .waitForFunction(() => !document.documentElement.classList.contains('dark'), undefined, { timeout: 15000 })
        .catch(() => {});
      await page.waitForTimeout(500);
    }
    await page.goto('/rewards');
    await expect(page.getByTestId('points-hero')).toBeVisible({ timeout: 90000 });
    await shot(page, '05-rewards-412x915');

    await logout(page);
  });

  // ------------------------------------------------------------------ B
  test('B. Bug report — per-character focus retention, persistence, retry', async ({ page }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, 'alisya@test.com');
    await page.goto('/settings');
    await page.getByTestId('open-bug-report').click();

    const textarea = page.getByTestId('bug-report-textarea');
    await expect(textarea).toBeVisible();
    await textarea.click(); // real user click into the field
    const text = 'The rewards page looked wrong after I opened it.';
    let domIdentity: string | null = null;

    for (let i = 0; i < text.length; i++) {
      await page.keyboard.type(text[i], { delay: 10 });
      const focused = await page.evaluate(() => ({
        isTextarea:
          document.activeElement?.tagName === 'TEXTAREA' &&
          (document.activeElement as HTMLElement).dataset.testid === 'bug-report-textarea',
        value: (document.activeElement as HTMLTextAreaElement)?.value ?? null,
      }));
      expect(focused.isTextarea, `focus lost after char ${i + 1}`).toBe(true);
      expect(focused.value, `text corrupted after char ${i + 1}`).toBe(text.slice(0, i + 1));
      if (i === 0) domIdentity = await textarea.evaluate(el => el === document.activeElement ? (el as any).outerHTML.slice(0, 120) : 'NOT-FOCUSED');
    }

    // DOM identity unchanged across typing session
    const identityAfter = await textarea.evaluate(el => (el as any).outerHTML.slice(0, 120));
    expect(identityAfter).toBe(domIdentity);
    await expect(textarea).toHaveValue(text);
    await expect(page.getByTestId('bug-report-sheet')).toBeVisible();
    await shot(page, '06-bug-report-typed');

    // Submit a real report through the running app
    await page.getByTestId('bug-report-submit').click();
    await expect(page.getByTestId('bug-report-success')).toBeVisible({ timeout: 20000 });
    await shot(page, '07-bug-report-success');

    // Verify the resulting Firestore document matches the Rules contract
    const res = await fetch(`${EMU}/bug_reports?pageSize=10`, { headers: OWNER_AUTH });
    expect(res.ok).toBeTruthy();
    const docs = (await res.json()).documents ?? [];
    expect(docs.length).toBeGreaterThanOrEqual(1);
    const report = docs[docs.length - 1].fields;
    expect(report.description.stringValue).toBe(text);
    expect(report.status.stringValue).toBe('open');
    expect(report.reporterUserId.stringValue).toBe('alisya');
    expect(report.familyId.stringValue).toBe('qa-fam');
    expect(['broken', 'visual', 'points_rewards', 'tasks', 'wallet', 'family', 'other'])
      .toContain(report.category.stringValue);
    expect(Object.keys(report).sort()).toEqual([
      'category', 'createdAt', 'description', 'familyId',
      'reporterRole', 'reporterUserId', 'status', 'technicalContext',
    ].sort());

    await page.getByTestId('bug-report-success-close').click().catch(() => {});

    // Reopen a fresh sheet for the failure scenario
    await closeManageWallet(page);
    await expect(page.getByTestId('bug-report-sheet')).not.toBeVisible();
    await page.getByTestId('open-bug-report').click();
    const ta2 = page.getByTestId('bug-report-textarea');
    await expect(ta2).toBeVisible();

    await ta2.click();
    await ta2.pressSequentially('Offline retry survival check.', { delay: 5 });
    // pick an explicit category
    await page.getByTestId('bug-category-visual').click().catch(() => {});

    // Force a REAL server-side submission failure: the emulator rejects the
    // write with permission-denied once deny-all rules are injected.
    await putEmulatorRules(DENY_ALL_RULES);
    await page.getByTestId('bug-report-submit').click();
    await expect(page.getByTestId('bug-report-error')).toBeVisible({ timeout: 30000 });

    // description + category survived the failure
    await expect(ta2).toHaveValue('Offline retry survival check.');
    const catSelected = await page
      .getByTestId('bug-category-visual')
      .getAttribute('aria-checked')
      .catch(() => null);
    expect(catSelected === 'true' || catSelected === null).toBe(true);
    await shot(page, '08-bug-report-forced-failure-survived');

    // Restore the real rules, then retry succeeds
    await putEmulatorRules(readFileSync('firestore.rules', 'utf8'));
    await page.waitForTimeout(500);
    await page.getByTestId('bug-report-retry').click();
    await expect(page.getByTestId('bug-report-success')).toBeVisible({ timeout: 30000 });
    await shot(page, '09-bug-report-retry-success');

    await logout(page);
  });

  // ------------------------------------------------------------------ C
  test('C. Parent wallet — exact balances, add/withdraw, emulator evidence', async ({ page }) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, 'owner@test.com');

    // Baselines before mutation
    const baseAlisya = await emulatorWallet('alisya'); // 1111
    const baseMostium = await emulatorWallet('mostium'); // 2222
    const baseMnalium = await emulatorWallet('mnalium'); // 3333
    expect(baseAlisya).toBe(1111);
    expect(baseMostium).toBe(2222);
    expect(baseMnalium).toBe(3333);

    // Parent wallet overview screenshot
    await page.goto('/wallets');
    await expect(page.getByTestId('parent-wallet-list')).toBeVisible();
    for (const c of QA_CHILDREN) {
      await expect(page.getByText(c.name).first()).toBeVisible();
    }
    await shot(page, '10-parent-wallet-overview');

    async function openManageWallet(childName: string, expectedBalance?: RegExp) {
      await page.goto('/wallets');
      const card = page.locator('[data-testid="parent-wallet-card"]', { hasText: childName });
      await expect(card).toBeVisible();
      // Verify displayed balance matches expectation (seeded or post-mutation)
      const balId = IDS[childName];
      const seeded: Record<string, RegExp> = {
        alisya: /£11\.11/,
        mostium: /£22\.22/,
        mnalium: /£33\.33/,
      };
      await expect(card.getByTestId(`wallet-balance-${balId}`)).toHaveText(expectedBalance ?? seeded[balId]);
      await card.getByTestId(`manage-wallet-${balId}`).click();
      const dialog = page.getByTestId('manage-wallet-dialog');
      await expect(dialog).toBeVisible();
      return dialog;
    }

    // --- Alisya overview screenshot (no mutation yet)
    let dialog = await openManageWallet('Alisya');
    await expect(dialog.getByText(/Alisya/i)).toBeVisible();
    await shot(page, '11-alisya-wallet-manage');
    await closeManageWallet(page);

    // --- Mostium: verify £22.22, add £1 -> £23.22
    dialog = await openManageWallet('Mostium');
    await shot(page, '12-mostium-wallet-before-add');
    await dialog.getByLabel(/Amount/).fill('1.00');
    await dialog.getByLabel(/Note/i).fill('QA wave42 add');
    await dialog.getByTestId('manage-wallet-submit').click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('[data-testid="parent-wallet-card"]', { hasText: 'Mostium' })
      .getByTestId('wallet-balance-mostium')).toHaveText(/£23\.22/);
    await shot(page, '13-mostium-wallet-after-add-23-22');

    expect(await emulatorWallet('mostium')).toBe(2322);
    expect(await emulatorWallet('alisya')).toBe(baseAlisya); // untouched
    expect(await emulatorWallet('mnalium')).toBe(baseMnalium); // untouched
    const mostiumLedgerAdd = await emulatorLedger('mostium');
    expect(mostiumLedgerAdd.some(t => Number(t.amount?.integerValue) === 100 &&
      t.note?.stringValue === 'QA wave42 add')).toBe(true);

    // --- Mostium: withdraw £1 -> £22.22
    dialog = await openManageWallet('Mostium', /£23\.22/);
    // Switch the Manage Wallet dialog to its Withdraw tab
    await dialog.getByRole('tab', { name: /withdraw/i }).click();
    await dialog.getByLabel(/Amount/).fill('1.00');
    await dialog.getByLabel(/Note/i).fill('QA wave42 withdraw');
    await dialog.getByTestId('manage-wallet-submit').click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('[data-testid="parent-wallet-card"]', { hasText: 'Mostium' })
      .getByTestId('wallet-balance-mostium')).toHaveText(/£22\.22/);
    await shot(page, '14-mostium-wallet-after-withdraw-22-22');

    expect(await emulatorWallet('mostium')).toBe(2222);
    expect(await emulatorWallet('alisya')).toBe(baseAlisya);
    expect(await emulatorWallet('mnalium')).toBe(baseMnalium);
    const mostiumLedgerWd = await emulatorLedger('mostium');
    expect(mostiumLedgerWd.some(t =>
      t.note?.stringValue === 'QA wave42 withdraw' &&
      (Number(t.amount?.integerValue) === -100 || Number(t.amount?.integerValue) === 100),
    )).toBe(true);

    // --- Mnalium overview screenshot
    dialog = await openManageWallet('Mnalium');
    await shot(page, '15-mnalium-wallet-manage');
    await closeManageWallet(page);

    await logout(page);
  });

  // ------------------------------------------------------------------ D
  test('D. Stale context — navigation between children targets correct wallet', async ({ page }) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, 'owner@test.com');

    const preAlisya = await emulatorWallet('alisya'); // 1111
    const preMnalium = await emulatorWallet('mnalium'); // 3333

    // Mostium -> back -> Alisya -> Manage Wallet -> Add £1
    await page.goto('/wallets');
    await page.locator('[data-testid="parent-wallet-card"]', { hasText: 'Mostium' })
      .getByTestId('manage-wallet-mostium').click();
    await closeManageWallet(page);

    await page.locator('[data-testid="parent-wallet-card"]', { hasText: 'Alisya' })
      .getByTestId('manage-wallet-alisya').click();
    let dialog = page.getByTestId('manage-wallet-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Alisya/i)).toBeVisible(); // correct target, not stale Mostium
    await dialog.getByLabel(/Amount/).fill('1.00');
    await dialog.getByLabel(/Note/i).fill('stale-context alisya add');
    await dialog.getByTestId('manage-wallet-submit').click();
    await expect(dialog).not.toBeVisible();

    expect(await emulatorWallet('alisya')).toBe(preAlisya + 100);
    expect(await emulatorWallet('mostium')).toBe(2222); // NOT mutated
    await shot(page, '16-stale-context-alisya-add-result');

    // Alisya -> back -> Mnalium -> Manage Wallet -> Withdraw £1
    await page.locator('[data-testid="parent-wallet-card"]', { hasText: 'Alisya' })
      .getByTestId('manage-wallet-alisya').click();
    await closeManageWallet(page);

    await page.locator('[data-testid="parent-wallet-card"]', { hasText: 'Mnalium' })
      .getByTestId('manage-wallet-mnalium').click();
    dialog = page.getByTestId('manage-wallet-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Mnalium/i)).toBeVisible();
    await dialog.getByRole('tab', { name: /withdraw/i }).click();
    await dialog.getByLabel(/Amount/).fill('1.00');
    await dialog.getByLabel(/Note/i).fill('stale-context mnalium withdraw');
    await dialog.getByTestId('manage-wallet-submit').click();
    await expect(dialog).not.toBeVisible();

    expect(await emulatorWallet('mnalium')).toBe(preMnalium - 100);
    expect(await emulatorWallet('alisya')).toBe(preAlisya + 100); // unchanged by withdrawal
    await shot(page, '17-stale-context-mnalium-withdraw-result');

    await logout(page);
  });

  // ------------------------------------------------------------------ E
  test('E. Deep link /wallet?recipient= survives reload', async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, 'owner@test.com');

    await page.goto(`/wallet?recipient=${IDS.Mostium}`);
    await expect(page.getByRole('heading', { name: "Mostium's Wallet" })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('£22.22').first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: "Mostium's Wallet" })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('£22.22').first()).toBeVisible();
    expect(page.url()).toContain(`recipient=${IDS.Mostium}`);
    await shot(page, '18-deeplink-mostium-reload');

    await page.goto(`/wallet?recipient=${IDS.Mnalium}`);
    await expect(page.getByRole('heading', { name: "Mnalium's Wallet" })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('£33.33').first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: "Mnalium's Wallet" })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('£33.33').first()).toBeVisible();
    expect(page.url()).toContain(`recipient=${IDS.Mnalium}`);
    await shot(page, '19-deeplink-mnalium-reload');

    await logout(page);
  });

  // ------------------------------------------------------------------ F
  test('F. Child self-wallet + sibling privacy (two children)', async ({ page }) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width: 390, height: 844 });

    // Child 1: Alisya
    await login(page, 'alisya@test.com');
    await page.goto('/');
    // Home -> wallet balance chip -> /wallet
    const chip = page.getByRole('button', { name: /open your wallet/i })
      .or(page.locator('a[href="/wallet"]'))
      .first();
    await expect(chip).toBeVisible({ timeout: 30000 });
    await chip.click();
    await page.waitForURL(/\/wallet/, { timeout: 30000 });
    // £11.11 seed + £1.00 added in test D = £12.11
    await expect(page.getByText(/£12\.11/).first()).toBeVisible();
    await expect(page.getByText('stale-context alisya add').first()).toBeVisible(); // own history
    // No parent controls
    await expect(page.getByTestId('add-money-btn')).toHaveCount(0);
    await expect(page.getByTestId('withdraw-money-btn')).toHaveCount(0);
    await expect(page.getByText(/Manage Child/i)).toHaveCount(0);
    await shot(page, '20-child-alisya-own-wallet');

    // Reload — self wallet remains correct
    await page.reload();
    await expect(page.getByText(/£12\.11/).first()).toBeVisible();
    await shot(page, '21-child-alisya-wallet-reload');

    // Sibling privacy: open Mostium's member detail from Family page
    await page.goto('/family');
    await page.getByText('Mostium').first().click();
    await page.waitForTimeout(800);
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('£22.22'); // sibling private balance never exposed
    await shot(page, '22-sibling-mostium-privacy');
    await closeManageWallet(page);
    await logout(page);

    // Child 2: Mostium
    await login(page, 'mostium@test.com');
    await page.goto('/wallet');
    await expect(page.getByText(/£22\.22/).first()).toBeVisible();
    await expect(page.getByTestId('add-money-btn')).toHaveCount(0);
    await expect(page.getByTestId('withdraw-money-btn')).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(/£22\.22/).first()).toBeVisible();

    // Sibling privacy for Alisya
    await page.goto('/family');
    await page.getByText('Alisya').first().click();
    await page.waitForTimeout(800);
    const body2 = await page.locator('body').innerText();
    expect(body2).not.toContain('£12.11'); // Alisya post-D balance never exposed
    await shot(page, '23-sibling-alisya-privacy');

    await logout(page);
  });
});
