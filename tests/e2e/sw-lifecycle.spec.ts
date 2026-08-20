import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { startSwServer } from './sw-lifecycle-server.mjs';

const PORT = 5175;
const here = dirname(fileURLToPath(import.meta.url));
const shaInfo: { old: string; new: string; normal: string } = JSON.parse(
  readFileSync(resolve(here, '../../e2e-artifacts/sha.json'), 'utf8'),
);
let server: Awaited<ReturnType<typeof startSwServer>>;

test.beforeAll(async () => {
  server = await startSwServer(
    PORT,
    resolve(here, '../../e2e-artifacts/old'),
    resolve(here, '../../e2e-artifacts/new'),
    resolve(here, '../../e2e-artifacts/normal'),
  );
});
test.afterAll(async () => server?.close());

async function instrument(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const loadKey = '__sw_e2e_load_count';
    const loads = Number(sessionStorage.getItem(loadKey) || '0') + 1;
    sessionStorage.setItem(loadKey, String(loads));
    (window as any).__loadCount = loads;

    const ccKey = '__sw_e2e_controller_changes';
    (window as any).__controllerChanges = Number(sessionStorage.getItem(ccKey) || '0');
    navigator.serviceWorker?.addEventListener('controllerchange', () => {
      const count = Number(sessionStorage.getItem(ccKey) || '0') + 1;
      sessionStorage.setItem(ccKey, String(count));
      (window as any).__controllerChanges = count;
    });

    const messageKey = '__sw_e2e_inbound_messages';
    (window as any).__inboundMessages = JSON.parse(sessionStorage.getItem(messageKey) || '[]');
    navigator.serviceWorker?.addEventListener('message', event => {
      const value = event.data?.type ? `${event.data.type}:${event.data.migrationId || ''}` : String(event.data);
      const messages = JSON.parse(sessionStorage.getItem(messageKey) || '[]');
      messages.push(value);
      sessionStorage.setItem(messageKey, JSON.stringify(messages));
      (window as any).__inboundMessages = messages;
    });

    const outboundKey = '__sw_e2e_outbound_messages';
    const outbound: string[] = JSON.parse(sessionStorage.getItem(outboundKey) || '[]');
    (window as any).__outboundMessages = outbound;
    const proto = (window as any).ServiceWorker?.prototype;
    if (proto && !proto.__migrationPatched) {
      const original = proto.postMessage;
      proto.postMessage = function (...args: unknown[]) {
        const message: any = args[0];
        outbound.push(message?.type || String(message));
        sessionStorage.setItem(outboundKey, JSON.stringify(outbound));
        return original.apply(this, args);
      };
      proto.__migrationPatched = true;
    }
  });
}

async function waitForSha(page: Page, expected: string): Promise<void> {
  await page.waitForFunction(
    sha => (window as any).__FAMILYQUEST_BUILD__?.sha === sha,
    expected,
    { timeout: 45_000 },
  );
}

async function waitForActiveWorker(page: Page): Promise<void> {
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.active?.state === 'activated';
  }, null, { timeout: 45_000 });
}

async function establishGenuineLegacyControl(page: Page): Promise<number> {
  server.setBuild('old');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForSha(page, shaInfo.old);
  await waitForActiveWorker(page);
  // Registration can briefly disappear while WebKit/Chromium persist the
  // newly activated worker. Require it to remain observable before navigating.
  await page.waitForTimeout(1_000);
  await waitForActiveWorker(page);
  // A distinct navigation after activation creates the genuinely controlled
  // legacy document. This avoids browser-specific reload reuse semantics.
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => navigator.serviceWorker.controller?.state === 'activated',
    null,
    { timeout: 45_000 },
  );
  await waitForSha(page, shaInfo.old);

  const scriptUrl = await page.locator('script[type="module"][src]').getAttribute('src');
  expect(scriptUrl).toBeTruthy();
  const legacyBundle = await (await page.request.get(new URL(scriptUrl!, page.url()).toString())).text();
  expect(legacyBundle).not.toContain('reversal-status');
  return page.evaluate(() => (window as any).__loadCount);
}

async function requestWorkerUpdate(page: Page, build: 'new' | 'normal'): Promise<void> {
  server.setBuild(build);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });
}

test.describe('one-time legacy service-worker migration', () => {
  test.beforeEach(async ({ context }) => instrument(context));

  test('82422c8 is claimed, navigated once, and a later normal release rolls forward safely', async ({ page, context }) => {
    const baseline = await establishGenuineLegacyControl(page);

    await requestWorkerUpdate(page, 'new');
    await waitForSha(page, shaInfo.new);

    const migrated = await page.evaluate(() => ({
      sha: (window as any).__FAMILYQUEST_BUILD__.sha,
      loads: (window as any).__loadCount,
      controllerChanges: (window as any).__controllerChanges,
      inbound: (window as any).__inboundMessages,
      controller: navigator.serviceWorker.controller && {
        state: navigator.serviceWorker.controller.state,
        scriptURL: navigator.serviceWorker.controller.scriptURL,
      },
    }));
    expect(migrated.sha).toBe(shaInfo.new);
    expect(migrated.loads).toBe(baseline + 1);
    expect(migrated.controllerChanges).toBeGreaterThanOrEqual(1);
    expect(migrated.inbound).toContain('LEGACY_SW_MIGRATION_NAVIGATING:legacy-82422c8-2026-08');
    expect(migrated.controller?.state).toBe('activated');

    await expect(page.getByText('Welcome back', { exact: true })).toBeVisible({ timeout: 20_000 });
    await page.waitForFunction(() => Boolean((window as any).__QUEKI_STARTUP_METRICS__));
    const migrationBundleUrl = await page.locator('script[type="module"][src]').getAttribute('src');
    const migrationBundle = await (await page.request.get(new URL(migrationBundleUrl!, page.url()).toString())).text();
    expect(migrationBundle).toContain('reversal-status');

    // Waiting does not retrigger migration.
    await page.waitForTimeout(2_000);
    expect(await page.evaluate(() => (window as any).__loadCount)).toBe(baseline + 1);

    // An intentional revisit is one ordinary navigation, never an extra migration reload.
    await page.goto('/rewards', { waitUntil: 'domcontentloaded' });
    await waitForSha(page, shaInfo.new);
    expect(await page.evaluate(() => (window as any).__loadCount)).toBe(baseline + 2);
    await page.waitForTimeout(1_000);
    expect(await page.evaluate(() => (window as any).__loadCount)).toBe(baseline + 2);

    // A fresh tab opened after activation loads normally exactly once.
    const fresh = await context.newPage();
    await fresh.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForSha(fresh, shaInfo.new);
    expect(await fresh.evaluate(() => (window as any).__loadCount)).toBe(1);
    await fresh.waitForTimeout(1_000);
    expect(await fresh.evaluate(() => (window as any).__loadCount)).toBe(1);
    await fresh.close();

    // Rollback proof: a subsequent normal prompt/waiting release takes over via
    // the existing safe handler and causes one reload, with no migration behavior.
    await page.evaluate(() => (window as any).__reportStartupPhase?.('ready'));
    const beforeNormal = await page.evaluate(() => (window as any).__loadCount);
    await requestWorkerUpdate(page, 'normal');
    await waitForSha(page, shaInfo.normal);
    await expect(page.getByText('Welcome back', { exact: true })).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => (window as any).__loadCount)).toBe(beforeNormal + 1);
    expect(await page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
    expect(await page.evaluate(() => (window as any).__outboundMessages)).toContain('SKIP_WAITING');
    await page.waitForTimeout(2_000);
    expect(await page.evaluate(() => (window as any).__loadCount)).toBe(beforeNormal + 1);

    console.log(
      `[MIGRATION] OLD_SHA=${shaInfo.old} -> NEW_SHA=${shaInfo.new} -> NORMAL_SHA=${shaInfo.normal}` +
      ` | migrationReloads=1 | normalReloads=1 | controller=${migrated.controller?.state}`,
    );
  });
});
