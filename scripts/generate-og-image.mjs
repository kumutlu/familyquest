/**
 * Renders the Queki Open Graph card (1200x630) to public/og/queki-og.png.
 *
 * The card is intentionally minimal: a large wordmark and one short line of
 * supporting copy, both readable at WhatsApp's small preview size. No dashboard
 * screenshots, no tiny text, no legacy branding.
 *
 * Usage: node scripts/generate-og-image.mjs
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const WIDTH = 1200;
const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(HERE, '../public/og');
const OUTPUT_FILE = resolve(OUTPUT_DIR, 'queki-og.png');

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1200px; height: 630px; }
      body {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 28px;
        /* A flat brand colour keeps the PNG small (a few KB) and renders
           without gradient banding in WhatsApp's aggressive re-encode. */
        background: #0f766e;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
        color: #ffffff;
      }
      .mark {
        width: 132px;
        height: 132px;
        border-radius: 34px;
        background: rgba(255, 255, 255, 0.14);
        border: 3px solid rgba(255, 255, 255, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 74px;
        font-weight: 800;
        letter-spacing: -2px;
      }
      h1 {
        font-size: 132px;
        font-weight: 800;
        letter-spacing: -4px;
      }
      p {
        font-size: 42px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.92);
      }
    </style>
  </head>
  <body>
    <div class="mark">Q</div>
    <h1>Queki</h1>
    <p>Family tasks, rewards & pocket money</p>
  </body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
await mkdir(OUTPUT_DIR, { recursive: true });
await page.screenshot({ path: OUTPUT_FILE, type: 'png' });
await browser.close();
console.log(`Wrote ${OUTPUT_FILE}`);
