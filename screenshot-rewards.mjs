import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Navigate to the Rewards page
  await page.goto('http://localhost:5174/rewards', { waitUntil: 'networkidle', timeout: 15000 });
  
  // Desktop screenshot
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: '/Users/kemal/.gemini/antigravity/scratch/family-gamification/screenshots/desktop-rewards.png', fullPage: true });
  console.log('Desktop screenshot taken');
  
  // iPhone 14 Pro screenshot (390px width)
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/Users/kemal/.gemini/antigravity/scratch/family-gamification/screenshots/iphone14pro-rewards.png', fullPage: true });
  console.log('iPhone 14 Pro screenshot taken');
  
  await browser.close();
}

main().catch(console.error);
