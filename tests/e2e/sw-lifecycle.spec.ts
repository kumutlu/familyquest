/**
 * PRE-DEPLOY Playwright E2E gate — safe service-worker update lifecycle.
 *
 * Proves in a REAL browser (production-built preview output, not mocked SW
 * unit objects) that a stale, controlled client is upgraded to a new build ONLY
 * after bootstrap is ready:
 *
 *   1. OLD preview build is served and established as the controlling SW/client.
 *   2. Page executes OLD_SHA via window.__FAMILYQUEST_BUILD__.sha.
 *   3. Served build is swapped to NEW (different SHA + new sw.js precache).
 *   4. An update check is triggered so the new SW reaches `waiting`.
 *   5. While bootstrap is NOT ready: no reload, old client keeps running,
 *      waiting worker is NOT activated.
 *   6. Startup phase is transitioned to `ready` via the app's real observable
 *      mechanism (window.__reportStartupPhase — the exact function the
 *      StartupScreen effect calls in production).
 *   7. Assert: waiting worker receives SKIP_WAITING, activates, page reloads
 *      exactly once, after reload sha === NEW_SHA, new SW controls the page,
 *      no reload occurred during bootstrap.
 *   8. Also covers the already-ready case (waiting worker + app ready ->
 *      update activates and reloads safely, sha becomes NEW_SHA).
 *
 * The server (sw-lifecycle-server.mjs) serves either the OLD or NEW build from
 * the same origin/port and can be swapped at runtime, so the browser's native
 * SW update mechanism detects the new sw.js and parks it in `waiting`.
 */
import { test, expect, type BrowserContext, type Page, chromium, devices } from '@playwright/test';
import { startSwServer } from './sw-lifecycle-server.mjs';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = 5175;

interface ShaInfo {
  old: string;
  new: string;
}
const shaInfo: ShaInfo = JSON.parse(
  readFileSync(resolve(__dirname, '../../e2e-artifacts/sha.json'), 'utf8'),
);

let server: Awaited<ReturnType<typeof startSwServer>>;

test.beforeAll(async () => {
  server = await startSwServer(
    PORT,
    resolve(__dirname, '../../e2e-artifacts/old'),
    resolve(__dirname, '../../e2e-artifacts/new'),
  );
});

test.afterAll(async () => {
  await server?.close();
});

// Instrument every page (and every reload) with cross-reload counters so we can
// prove exactly how many reloads occurred and what messages the SW received.
async function installInstrumentation(context: BrowserContext): Promise<void> {
  // Reload counter — survives reloads via sessionStorage.
  await context.addInitScript(() => {
    const KEY = '__sw_e2e_reload_count';
    const n = Number(sessionStorage.getItem(KEY) || '0') + 1;
    sessionStorage.setItem(KEY, String(n));
    (window as unknown as { __reloadCount: number }).__reloadCount = n;
  });

  // Capture postMessages sent TO service workers (e.g. { type: 'SKIP_WAITING' }).
  // NOTE: we must forward EVERY argument via `apply` — the browser passes a
  // second argument (transfer list / postMessage options) and dropping it breaks
  // the SW install handshake, hanging activation.
  await context.addInitScript(() => {
    const KEY = '__sw_e2e_messages';
    const arr: string[] = JSON.parse(sessionStorage.getItem(KEY) || '[]');
    (window as unknown as { __swMessages: string[] }).__swMessages = arr;
    const proto = (window as unknown as { ServiceWorker?: { prototype: any } }).ServiceWorker
      ?.prototype;
    if (proto && !proto.__patched) {
      const orig = proto.postMessage;
      proto.postMessage = function (...args: unknown[]) {
        const msg = args[0];
        const type = msg && typeof msg === 'object' && 'type' in msg
          ? String((msg as { type: unknown }).type)
          : String(msg);
        arr.push(type);
        sessionStorage.setItem(KEY, JSON.stringify(arr));
        (window as unknown as { __swMessages: string[] }).__swMessages = arr;
        return orig.apply(this, args);
      };
      proto.__patched = true;
    }
  });

  // Count controllerchange events (proves the waiting worker took over).
  await context.addInitScript(() => {
    const KEY = '__sw_e2e_cc';
    (window as unknown as { __controllerChanges: number }).__controllerChanges = Number(
      sessionStorage.getItem(KEY) || '0',
    );
    const sw = (window as unknown as { navigator: { serviceWorker?: any } }).navigator
      ?.serviceWorker;
    if (sw && !sw.__ccPatched) {
      sw.addEventListener('controllerchange', () => {
        const n = Number(sessionStorage.getItem(KEY) || '0') + 1;
        sessionStorage.setItem(KEY, String(n));
        (window as unknown as { __controllerChanges: number }).__controllerChanges = n;
      });
      sw.__ccPatched = true;
    }
  });
}

async function establishOldControl(page: Page): Promise<{ sha: string; baseline: number }> {
  server.setBuild('old');
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // The app bundle must have published its build identifier.
  await page.waitForFunction(
    () => !!(window as unknown as { __FAMILYQUEST_BUILD__?: { sha?: string } }).__FAMILYQUEST_BUILD__?.sha,
    null,
    { timeout: 30000 },
  );

  // Wait until the OLD SW has FULLY activated (not merely 'activating'),
  // otherwise the reload below would race the install and the tab would stay
  // uncontrolled. Manual polling (waitForFunction's async predicate is flaky
  // here for an unknown reason in this Chromium build).
  {
    const start = Date.now();
    let activated = false;
    while (Date.now() - start < 30000) {
      activated = await page.evaluate(async () => {
        const reg = await (window as unknown as {
          navigator: {
            serviceWorker: {
              getRegistration: () => Promise<{ active?: { state: string } } | null>;
            };
          };
        }).navigator.serviceWorker.getRegistration();
        return !!(reg && reg.active && reg.active.state === 'activated');
      });
      if (activated) break;
      await page.waitForTimeout(250);
    }
    if (!activated) throw new Error('OLD SW did not reach activated state');
  }

  // registerType:'prompt' + clientsClaim:false => the first load is NOT
  // controlled. Reload so the already-active OLD SW takes control of the tab.
  await page.reload({ waitUntil: 'domcontentloaded' });
  {
    const start = Date.now();
    let controlled = false;
    while (Date.now() - start < 30000) {
      controlled = await page.evaluate(() => {
        const c = (window as unknown as { navigator: { serviceWorker?: { controller?: { state: string } } } })
          .navigator.serviceWorker?.controller;
        return !!c && c.state === 'activated';
      });
      if (controlled) break;
      await page.waitForTimeout(250);
    }
    if (!controlled) throw new Error('OLD SW did not take control after reload');
  }

  const sha = await page.evaluate(
    () => (window as unknown as { __FAMILYQUEST_BUILD__: { sha: string } }).__FAMILYQUEST_BUILD__.sha,
  );
  const baseline = await page.evaluate(
    () => (window as unknown as { __reloadCount: number }).__reloadCount,
  );
  return { sha, baseline };
}

async function waitForWaitingWorker(page: Page, timeout = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const found = await page.evaluate(async () => {
      const reg = await (window as unknown as {
        navigator: { serviceWorker: { getRegistration: () => Promise<{ waiting?: unknown } | null> } };
      }).navigator.serviceWorker.getRegistration();
      return !!(reg && reg.waiting);
    });
    if (found) return;
    await page.waitForTimeout(250);
  }
  throw new Error('No waiting service worker appeared after update');
}

async function triggerUpdate(page: Page): Promise<void> {
  server.setBuild('new');
  await page.evaluate(async () => {
    const reg = await (window as unknown as {
      navigator: { serviceWorker: { getRegistration: () => Promise<{ update?: () => Promise<void> } | null> } };
    }).navigator.serviceWorker.getRegistration();
    if (reg && reg.update) await reg.update();
  });
}

// Drives the startup phase through the EXACT production path the StartupScreen
// effect uses (reportStartupPhase). No separate code path is created.
async function transitionToReady(page: Page): Promise<void> {
  await page.evaluate(() => {
    const fn = (window as unknown as { __reportStartupPhase?: (p: string) => void }).__reportStartupPhase;
    if (fn) fn('ready');
  });
}

test.describe('Safe service-worker update lifecycle', () => {
  let browser: import('@playwright/test').Browser;
  let context: BrowserContext;
  let page: Page;

  // A fresh browser per test guarantees an isolated service-worker database, so a
  // prior test's OLD/NEW SW registration can never leak into the next run.
  test.beforeEach(async () => {
    browser = await chromium.launch();
    context = await browser.newContext({ ...devices['Desktop Chrome'] });
    await installInstrumentation(context);
    page = await context.newPage();
  });

  test.afterEach(async () => {
    await context?.close();
    await browser?.close();
  });

  test('deferred: stale controlled client upgrades only after bootstrap is ready', async () => {
    const { sha: oldSha, baseline } = await establishOldControl(page);
    expect(oldSha).toBe(shaInfo.old);

    // 3 + 4. Swap to NEW build and trigger an update check -> new SW reaches waiting.
    await triggerUpdate(page);
    await waitForWaitingWorker(page);

    // 5. While bootstrap is NOT ready:
    const waitingState = await page.evaluate(async () => {
      const reg = await (window as unknown as {
        navigator: { serviceWorker: { getRegistration: () => Promise<{ waiting?: { state: string } } | null> } };
      }).navigator.serviceWorker.getRegistration();
      return reg?.waiting?.state ?? null;
    });
    expect(waitingState).toBe('installed'); // waiting, NOT activated

    const controllerStateDuringBootstrap = await page.evaluate(
      () => (window as unknown as { navigator: { serviceWorker: { controller?: { state: string } } } })
        .navigator.serviceWorker.controller?.state,
    );
    expect(controllerStateDuringBootstrap).toBe('activated'); // still the OLD SW

    const countDuringBootstrap = await page.evaluate(
      () => (window as unknown as { __reloadCount: number }).__reloadCount,
    );
    expect(countDuringBootstrap).toBe(baseline); // no reload yet

    const shaDuringBootstrap = await page.evaluate(
      () => (window as unknown as { __FAMILYQUEST_BUILD__: { sha: string } }).__FAMILYQUEST_BUILD__.sha,
    );
    expect(shaDuringBootstrap).toBe(oldSha); // old client still running

    // 6. Transition startup to ready (real production path via test hook).
    const loadPromise = page.waitForEvent('load');
    await transitionToReady(page);
    await loadPromise; // the safe reload

    // 7. After ready: waiting worker got SKIP_WAITING, activated, reloaded once.
    const finalSha = await page.evaluate(
      () => (window as unknown as { __FAMILYQUEST_BUILD__: { sha: string } }).__FAMILYQUEST_BUILD__.sha,
    );
    expect(finalSha).toBe(shaInfo.new);
    expect(finalSha).not.toBe(oldSha);

    const finalCount = await page.evaluate(
      () => (window as unknown as { __reloadCount: number }).__reloadCount,
    );
    expect(finalCount).toBe(baseline + 1); // exactly one reload

    const messages = await page.evaluate(
      () => (window as unknown as { __swMessages: string[] }).__swMessages,
    );
    expect(messages).toContain('SKIP_WAITING');

    const controller = await page.evaluate(() => {
      const c = (window as unknown as { navigator: { serviceWorker: { controller?: { state: string; scriptURL: string } } } })
        .navigator.serviceWorker.controller;
      return c ? { state: c.state, scriptURL: c.scriptURL } : null;
    });
    expect(controller).not.toBeNull();
    expect(controller!.state).toBe('activated'); // new SW controls the page

    const cc = await page.evaluate(
      () => (window as unknown as { __controllerChanges: number }).__controllerChanges,
    );
    expect(cc).toBeGreaterThanOrEqual(1); // controller changed (waiting -> active)

    console.log(
      `[E2E][deferred] OLD_SHA=${oldSha} -> NEW_SHA=${finalSha} | reloads=${finalCount - baseline} | SKIP_WAITING=${messages.includes('SKIP_WAITING')} | controller=${controller!.state}`,
    );
  });

  test('already-ready: waiting worker activates and reloads safely', async () => {
    const { sha: oldSha, baseline } = await establishOldControl(page);
    expect(oldSha).toBe(shaInfo.old);

    // App already ready before the update is found. The waiting worker is
    // therefore applied immediately (no deferral), so it never lingers in the
    // `waiting` state — we wait for the resulting safe reload instead.
    await transitionToReady(page);

    const loadPromise = page.waitForEvent('load');
    await triggerUpdate(page);
    await loadPromise; // the safe reload (waiting worker applied immediately)

    const finalSha = await page.evaluate(
      () => (window as unknown as { __FAMILYQUEST_BUILD__: { sha: string } }).__FAMILYQUEST_BUILD__.sha,
    );
    expect(finalSha).toBe(shaInfo.new);
    expect(finalSha).not.toBe(oldSha);

    const finalCount = await page.evaluate(
      () => (window as unknown as { __reloadCount: number }).__reloadCount,
    );
    expect(finalCount).toBe(baseline + 1); // exactly one reload

    const messages = await page.evaluate(
      () => (window as unknown as { __swMessages: string[] }).__swMessages,
    );
    expect(messages).toContain('SKIP_WAITING');

    const controllerState = await page.evaluate(
      () => (window as unknown as { navigator: { serviceWorker: { controller?: { state: string } } } })
        .navigator.serviceWorker.controller?.state,
    );
    expect(controllerState).toBe('activated');

    console.log(
      `[E2E][already-ready] OLD_SHA=${oldSha} -> NEW_SHA=${finalSha} | reloads=${finalCount - baseline} | SKIP_WAITING=${messages.includes('SKIP_WAITING')} | controller=${controllerState}`,
    );
  });
});
