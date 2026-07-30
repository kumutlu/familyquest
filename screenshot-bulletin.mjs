import { chromium } from 'playwright';

const breakpoints = [
  { name: '320px', width: 320, height: 800 },
  { name: '375px', width: 375, height: 812 },
  { name: '390px-iPhone14Pro', width: 390, height: 844 },
  { name: '430px', width: 430, height: 932 },
  { name: '768px', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
await page.goto('http://localhost:5174', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

for (const bp of breakpoints) {
  await page.setViewportSize({ width: bp.width, height: bp.height });
  await page.waitForTimeout(500);
  
  const screenshotPath = `screenshots/bulletin-${bp.name}.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Screenshot saved: bulletin-${bp.name}.png (${bp.width}x${bp.height})`);
}

await browser.close();
console.log('Done!');
