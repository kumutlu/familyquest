import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');

const metaContent = (attribute: 'property' | 'name', key: string) => {
  const match = html.match(
    new RegExp(`<meta\\s+${attribute}="${key}"\\s+content="([^"]*)"`, 'i'),
  );
  return match?.[1] ?? null;
};

describe('social sharing preview metadata', () => {
  it('has a Queki document title and description with no legacy branding', () => {
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
    expect(title).toContain('Queki');
    expect(title).not.toMatch(/familyquest/i);
    expect(metaContent('name', 'description')).toMatch(/Queki/);
  });

  it('declares every Open Graph and Twitter tag on the canonical domain', () => {
    expect(metaContent('property', 'og:type')).toBe('website');
    expect(metaContent('property', 'og:url')).toBe('https://queki.app/');
    expect(metaContent('property', 'og:title')).toMatch(/Queki/);
    expect(metaContent('property', 'og:description')).toMatch(/Queki/);
    expect(metaContent('property', 'og:image')).toBe('https://queki.app/og/queki-og.png');
    expect(metaContent('property', 'og:image:width')).toBe('1200');
    expect(metaContent('property', 'og:image:height')).toBe('630');
    expect(metaContent('name', 'twitter:card')).toBe('summary_large_image');
    expect(metaContent('name', 'twitter:title')).toMatch(/Queki/);
    expect(metaContent('name', 'twitter:description')).toMatch(/Queki/);
    expect(metaContent('name', 'twitter:image')).toBe('https://queki.app/og/queki-og.png');
  });

  it('uses absolute https URLs for every social image', () => {
    for (const attribute of ['og:image', 'twitter:image'] as const) {
      const key = attribute.startsWith('og:') ? 'property' : 'name';
      const value = metaContent(key as 'property' | 'name', attribute);
      expect(value).toMatch(/^https:\/\//);
    }
  });

  it('contains no FamilyQuest reference anywhere in the document head', () => {
    const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? '';
    expect(head).not.toMatch(/familyquest/i);
  });

  it('ships a web-optimised 1200x630 PNG under public/og/', () => {
    const file = resolve(root, 'public/og/queki-og.png');
    const buffer = readFileSync(file);
    // PNG IHDR: width/height are big-endian uint32 at byte offsets 16 and 20.
    expect(buffer.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(buffer.readUInt32BE(16)).toBe(1200);
    expect(buffer.readUInt32BE(20)).toBe(630);
    // Keep the card small enough for fast WhatsApp/Slack unfurling.
    expect(statSync(file).size).toBeLessThan(300 * 1024);
  });
});
