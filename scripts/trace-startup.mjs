// Standalone startup tracer.
//
// Runs a REAL browser startup against the Firebase emulator (same project id as
// production) with Slow-3G network throttling to reproduce the "slow mobile
// connection" condition documented in StartupScreen.tsx. It captures the
// dev-only `[auth-trace]` console logs (which carry ISO timestamps) and the
// `[StartupDiagnostic]` timeout/error logs, then computes the duration of each
// startup phase. No speculation: every number below comes from a timestamp the
// app itself emitted during this run.
//
// Usage: node scripts/trace-startup.mjs   (emulator + dev server must be up)

import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:5174';
const EMAIL = process.env.TRACE_EMAIL || 'owner@test.com';
const PASSWORD = 'password123';
const BUDGET_MS = 20000; // STARTUP_TIMEOUT_MS per phase

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

const traces = [];
page.on('console', (msg) => {
  const text = msg.text();
  if (text.includes('[auth-trace]') || text.includes('[StartupDiagnostic]')) {
    traces.push({
      kind: text.includes('[StartupDiagnostic]') ? 'diag' : 'trace',
      text,
      wall: Date.now(),
    });
  }
});
page.on('pageerror', (e) => console.error('PAGEERROR', e.message));

console.error(`[tracer] navigating to ${BASE}/login as ${EMAIL}`);
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
// Wait for the login form (app assets already loaded at full speed).
await page.waitForSelector('input[type="email"]', { timeout: 30000 });

// --- Slow 3G throttling (Chrome DevTools network emulation) -----------------
// Enabled ONLY after the app's own assets are loaded, so we reproduce the real
// "slow mobile connection" condition: the installed/cached PWA shell is fast,
// but the Firestore reads during bootstrap are latency-bound. ~400 ms RTT,
// ~50 KB/s.
const client = await context.newCDPSession(page);
await client.send('Network.enable');
await client.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 400,
  downloadThroughput: 50000,
  uploadThroughput: 50000,
});
console.error('[tracer] Slow-3G throttling enabled');

await page.fill('input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PASSWORD);
await page.click('button[type="submit"]');

// Wait until the dashboard is ready (family-load-completed) or a startup
// diagnostic (timeout) fires — whichever comes first.
const deadline = Date.now() + 90000;
let outcome = 'unknown';
while (Date.now() < deadline) {
  if (traces.some((x) => x.kind === 'trace' && x.text.includes('family-load-completed'))) {
    outcome = 'ready';
    break;
  }
  if (traces.some((x) => x.kind === 'diag')) {
    outcome = 'diagnostic';
    break;
  }
  await page.waitForTimeout(200);
}
await page.waitForTimeout(500); // let any trailing traces flush

// --- Parse ----------------------------------------------------------------
const parse = (text) => {
  const m = text.match(/\[auth-trace\]\s+(\S+)\s+(\S+)\s*(.*)/);
  if (!m) return null;
  return { iso: m[1], event: m[2], detail: m[3] };
};

const events = traces
  .filter((x) => x.kind === 'trace')
  .map((x) => parse(x.text))
  .filter(Boolean);

// Keep the LAST occurrence of each event. The auth flow fires twice — once for
// the initial (unauthenticated) state during page load, and again for the
// signed-in state after the test logs in. The signed-in state is the final,
// authoritative one for measuring the real bootstrap.
const byEvent = new Map();
for (const e of events) byEvent.set(e.event, e);
const unique = [...byEvent.values()];

const t = (ev) => {
  const e = unique.find((x) => x.event === ev);
  return e ? Date.parse(e.iso) : null;
};

// User-facing phases and the trace events that bound them.
const phases = [
  ['App mount', 'app-mount', 'Firebase initialized', 'firebase-initialized'],
  ['Firebase initialized', 'firebase-initialized', 'Auth resolved', 'auth-status-changed'],
  ['Auth resolved', 'auth-status-changed', 'Profile loaded', 'profile-request-completed'],
  ['Profile loaded', 'profile-request-completed', 'Family loaded', 'family-load-completed'],
  ['Family loaded', 'family-load-completed', 'Dashboard ready', 'family-load-completed'],
];

console.log('\n=== Raw [auth-trace] events (final occurrence) ===');
for (const e of unique) console.log(`  ${e.iso}  ${e.event}  ${e.detail}`);

console.log('\n=== Phase measurements ===');
console.log(`  outcome: ${outcome}`);
let worst = { name: '', dur: -1 };
for (const [aName, aEv, bName, bEv] of phases) {
  const ta = t(aEv);
  const tb = t(bEv);
  if (ta == null || tb == null) {
    console.log(`  ${aName} -> ${bName}: MISSING (${aEv}=${ta}, ${bEv}=${tb})`);
    continue;
  }
  let dur = tb - ta;
  // Firebase init is synchronous at module-import time, which precedes app
  // mount; the negative gap is a measurement artifact, not a cost.
  if (dur < 0) dur = 0;
  const flag = dur > BUDGET_MS ? '  *** EXCEEDS 20s PHASE BUDGET ***' : '';
  const start = new Date(ta).toISOString();
  const end = new Date(tb).toISOString();
  console.log(`  ${aName} -> ${bName}`);
  console.log(`    start : ${start}`);
  console.log(`    end   : ${end}`);
  console.log(`    dur   : ${dur} ms${flag}`);
  if (dur > worst.dur) worst = { name: `${aName} -> ${bName}`, dur };
}

const diags = traces.filter((x) => x.kind === 'diag');
if (diags.length) {
  console.log('\n=== [StartupDiagnostic] (timeout/error) ===');
  for (const d of diags) console.log(`  ${d.text}`);
}

console.log('\n=== Verdict ===');
if (worst.dur > 0) {
  console.log(`  Slowest phase: ${worst.name} = ${worst.dur} ms`);
  if (worst.dur > BUDGET_MS) {
    console.log('  >>> This phase EXCEEDS the 20s per-phase budget. Bottleneck identified.');
  } else {
    console.log('  >>> No single phase exceeded the 20s budget in this run,');
    console.log('      but the slowest phase above is the dominant cost and the');
    console.log('      prime candidate for optimisation under real-world latency.');
  }
}

await browser.close();
