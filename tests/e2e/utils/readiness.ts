import { expect, type Page, type TestInfo } from '@playwright/test';

async function diagnosticState(page: Page) {
  const firstText = async (locator: ReturnType<Page['locator']>) =>
    await locator.count() ? await locator.first().textContent().catch(() => null) : null;
  const heading = await firstText(page.getByRole('heading'));
  const status = await firstText(page.locator('[role="status"]'));
  const error = await firstText(page.locator('[role="alert"]'));
  const diagnostic = page.getByTestId('e2e-bootstrap-state');
  const raw = await diagnostic.count() ? await diagnostic.textContent() : null;
  let bootstrap = {};
  try { bootstrap = raw ? JSON.parse(raw) : {}; } catch { /* report raw UI state */ }
  return { url: page.url(), heading, status, error, ...bootstrap };
}

async function attachFailure(testInfo: TestInfo | undefined, name: string, page: Page) {
  const state = await diagnosticState(page);
  if (testInfo) await testInfo.attach(name, { body: JSON.stringify(state, null, 2), contentType: 'application/json' });
  throw new Error(`${name}: ${JSON.stringify(state)}`);
}

export async function expectOwnerReady(page: Page, testInfo?: TestInfo) {
  try {
    await expect(page.locator('[data-testid="mobile-bottom-nav"]')).toBeAttached({ timeout: 20_000 });
  } catch { await attachFailure(testInfo, 'owner-readiness-terminal-state', page); }
}

export async function expectManagedChildReady(page: Page, testInfo?: TestInfo) {
  try {
    await expect(page.locator('[data-testid="mobile-bottom-nav"], [data-testid="required-password-change"]')).toBeAttached({ timeout: 20_000 });
  } catch { await attachFailure(testInfo, 'managed-child-readiness-terminal-state', page); }
}

export async function expectSignedOutReady(page: Page, testInfo?: TestInfo) {
  try {
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/login/);
  } catch { await attachFailure(testInfo, 'signed-out-readiness-terminal-state', page); }
}

export async function expectOnboardingP1TerminalState(page: Page, testInfo?: TestInfo) {
  const ready = page.getByRole('heading', { name: /your family is taking shape/i });
  const retry = page.getByRole('button', { name: /retry|try again/i });
  try {
    await expect(ready.or(retry).first()).toBeVisible({ timeout: 25_000 });
  } catch { await attachFailure(testInfo, 'onboarding-p1-terminal-state', page); }
  if (await retry.isVisible().catch(() => false)) await attachFailure(testInfo, 'onboarding-p1-error-terminal-state', page);
}
