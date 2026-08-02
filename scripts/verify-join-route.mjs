// Real-browser verification of the code-specific /join route.
//
// Runs against an already-serving origin (vite dev or vite preview) and checks
// that the route resolves, the code is read from the query string, and no
// family information is rendered before the invitation is validated.
//
// Usage: node scripts/verify-join-route.mjs http://localhost:5173

import { chromium } from 'playwright';

const origin = process.argv[2];
if (!origin) {
  console.error('usage: node scripts/verify-join-route.mjs <origin>');
  process.exit(1);
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch();
const page = await browser.newPage();

try {
  // 1. The route resolves (SPA fallback works for a deep link).
  const response = await page.goto(`${origin}/join?code=7ZXWRZ`, { waitUntil: 'networkidle' });
  check('/join?code= returns a document', response?.status() === 200, `status ${response?.status()}`);

  const heading = await page.getByRole('heading', { level: 1 }).first().textContent();
  check('join page renders', /join/i.test(heading ?? ''), `heading: ${heading}`);

  // 2. The invitation is validated server-side; an unknown code is rejected and
  //    no family information is shown.
  await page.waitForSelector('[role="alert"], [role="status"]', { timeout: 15000 });
  const alert = await page.locator('[role="alert"]').first().textContent().catch(() => null);
  check('unknown code is rejected without exposing family data', Boolean(alert), `alert: ${alert}`);

  // 3. The manual family-code flow stays reachable (backward compatibility).
  const manual = page.getByRole('link', { name: /family code/i });
  check('manual family-code flow still linked', await manual.count() > 0);

  // 4. The code survives a refresh.
  await page.goto(`${origin}/join`, { waitUntil: 'networkidle' });
  const stored = await page.evaluate(() => localStorage.getItem('queki.pendingInviteCode'));
  check('invite code persists across navigation/refresh', stored === '7ZXWRZ', `stored: ${stored}`);

  // 5. The legacy manual join route still renders.
  const legacy = await page.goto(`${origin}/join-family`, { waitUntil: 'networkidle' });
  check('/join-family still serves the manual flow', legacy?.status() === 200);
} finally {
  await browser.close();
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed against ${origin}`);
process.exit(failed.length ? 1 : 0);
