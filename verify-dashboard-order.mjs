import { chromium } from 'playwright';

const BASE = 'http://localhost:5174';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then(c => c.newPage());

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  await page.fill('input[type="email"]', 'owner@test.com');
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="rewards-summary"]', { timeout: 20000 });
  await page.waitForTimeout(2000);

  const order = await page.evaluate(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top + window.scrollY) };
    };
    const pickByText = (tag, text) => {
      const els = Array.from(document.querySelectorAll(tag));
      const el = els.find(e => e.textContent && e.textContent.includes(text));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top + window.scrollY) };
    };
    const items = [
      { label: 'Quick Actions', pos: pick('section[aria-labelledby="quick-actions-heading"]') },
      { label: 'Approval Center', pos: pickByText('h2', 'Approval Center') },
      { label: 'Family Bulletin', pos: pick('section[aria-labelledby="family-bulletin-heading"]') },
      { label: 'Wallet', pos: pick('[data-testid="wallet-summary"]') },
      { label: 'Goals', pos: pick('[data-testid="goal-summary"]') },
      { label: 'Rewards', pos: pick('[data-testid="rewards-summary"]') },
      { label: 'Pet Box', pos: pick('[data-testid="petbox-summary"]') },
      { label: 'Children Overview', pos: pick('section[aria-labelledby="children-overview-heading"]') },
      { label: 'Recent Family Activity', pos: pick('section[aria-labelledby="recent-activity-heading"]') },
    ];
    return items
      .filter(i => i.pos)
      .sort((a, b) => a.pos.top - b.pos.top)
      .map(i => i.label);
  });

  console.log('Rendered section order (top-to-bottom):');
  console.log(order.join('  ->  '));

  const hasPetBox = await page.locator('[data-testid="petbox-summary"]').count();
  const hasRewards = await page.locator('[data-testid="rewards-summary"]').count();
  console.log('petbox-summary count:', hasPetBox, '| rewards-summary count:', hasRewards);

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
