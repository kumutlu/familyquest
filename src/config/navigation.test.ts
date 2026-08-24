import { describe, it, expect } from 'vitest';
import { getNavItems, getQuekiNavItems } from './navigation';

const EXPECTED_DESKTOP_ITEMS = ['nav.home', 'nav.tasks', 'nav.rewards', 'nav.family'];
const EXPECTED_MOBILE_ITEMS = ['nav.home', 'nav.tasks', 'nav.rewards', 'nav.family'];

describe('navigation config (single source of truth)', () => {
  it('keeps Goals out of the simple desktop primary navigation', () => {
    const items = getNavItems();
    expect(items.map((i) => i.labelKey)).toEqual(EXPECTED_DESKTOP_ITEMS);
    expect(items.map((i) => i.path)).not.toContain('/goals');
  });

  it('keeps secondary parent areas out of the desktop primary route list', () => {
    expect(getNavItems().map((i) => i.path)).not.toContain('/pet-box');
    expect(getNavItems().map((i) => i.path)).not.toContain('/wallets');
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

  it('keeps the mobile bottom navigation at four routes around the central action', () => {
    expect(getQuekiNavItems().map(item => item.labelKey)).toEqual(EXPECTED_MOBILE_ITEMS);
    expect(getQuekiNavItems().map(item => item.path)).toEqual(['/', '/tasks', '/rewards', '/family']);
  });
});
