import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { minimatch } from 'minimatch';

type HostingRewrite = {
  source?: string;
  destination?: string;
};

const firebaseConfig = JSON.parse(readFileSync('firebase.json', 'utf8'));
const spaRewrite = (firebaseConfig.hosting.rewrites as HostingRewrite[]).find(
  rewrite => rewrite.destination === '/index.html',
);

function receivesSpaFallback(path: string) {
  if (!spaRewrite?.source) return false;
  return minimatch(path, spaRewrite.source);
}

describe('Firebase Hosting SPA fallback boundary', () => {
  it.each([
    '/assets/index-nonexistent-deadbeef.js',
    '/assets/index-nonexistent-deadbeef.css',
    '/assets/index-nonexistent-deadbeef.js.map',
    '/assets/nonexistent-deadbeef.woff2',
    '/assets/nonexistent-deadbeef.png',
  ])('does not rewrite missing static asset %s to index.html', path => {
    expect(receivesSpaFallback(path)).toBe(false);
  });

  it.each(['/', '/dashboard', '/settings', '/family'])(
    'continues to rewrite application navigation %s to index.html',
    path => {
      expect(receivesSpaFallback(path)).toBe(true);
    },
  );
});
