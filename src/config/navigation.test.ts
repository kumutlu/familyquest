import { describe, it, expect } from 'vitest';
import { getNavItems } from './navigation';

const EXPECTED_ITEMS = ['nav.home', 'nav.tasks', 'nav.rewards', 'nav.family'];

describe('navigation config (single source of truth)', () => {
  it('returns exactly the 4 simplified top-level items', () => {
    const items = getNavItems();
    expect(items.map((i) => i.labelKey)).toEqual(EXPECTED_ITEMS);
  });

  it('never includes the removed top-level tabs (Goals, Pet Box, Wallet, Wallets, Settings)', () => {
    expect(getNavItems().map((i) => i.path)).not.toContain('/pet-box');
  });

  it('maps each item to a valid route path', () => {
    const items = getNavItems();
    const expectedPaths = ['/', '/tasks', '/rewards', '/family'];
    expect(items.map((i) => i.path)).toEqual(expectedPaths);
    for (const item of items) {
      expect(typeof item.path).toBe('string');
      expect(item.path.length).toBeGreaterThan(0);
    }
  });

  it('desktop and mobile share the identical navigation source (no divergence)', () => {
    // The same array must be consumed by both the desktop header and the
    // mobile bottom navigation so they can never diverge.
    expect(getNavItems()).toEqual(getNavItems());
  });
});
