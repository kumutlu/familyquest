import { chromium } from 'playwright';

const BASE = 'http://localhost:5174';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Capture console errors for diagnostics
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));

  // Log in as the seeded owner (owner role -> Parent Dashboard)
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  await page.fill('input[type="email"]', 'owner@test.com');
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');

  // Wait for the dashboard to render (Quick Actions is always present for parents/owners)
  await page.waitForSelector('text=Quick Actions', { timeout: 20000 });
  // Wait for the summary cards to populate (rewards-summary is the new card)
  await page.waitForSelector('[data-testid="rewards-summary"]', { timeout: 20000 });
  // Give async data (wallets, goals, pet box) a moment to settle
  await page.waitForTimeout(2500);

  // Desktop screenshot
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'screenshots/dashboard-desktop.png', fullPage: true });
  console.log('Desktop screenshot saved: screenshots/dashboard-desktop.png');

  // iPhone 14 Pro screenshot (390 x 844)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'screenshots/dashboard-iphone14pro.png', fullPage: true });
  console.log('iPhone 14 Pro screenshot saved: screenshots/dashboard-iphone14pro.png');

  if (errors.length) {
    console.log('--- Console/page errors captured ---');
    errors.slice(0, 20).forEach(e => console.log(e));
  } else {
    console.log('No console/page errors captured.');
  }

  await browser.close();
  console.log('Done!');
}

main().catch(e => { console.error(e); process.exit(1); });
