import { describe, it, expect } from 'vitest';
import { getNavItems, getQuekiNavItems } from './navigation';

// V2 (2026-09-02) child-first navigation contract:
// Goals is NOT a primary navigation tab at any width. It is reachable from
// the More menu, from Child Home › Your Journey › Current Goal, and via the
// direct /goals deep link. The dedicated /goals route, the Goals feature,
// and the savings-goals data are unchanged.
const EXPECTED_PRIMARY_ITEMS = ['nav.home', 'nav.tasks', 'nav.rewards', 'nav.family'];

describe('navigation config (single source of truth)', () => {
  it('exposes the four-tab primary navigation on desktop (no Goals)', () => {
    const items = getNavItems();
    expect(items.map((i) => i.labelKey)).toEqual(EXPECTED_PRIMARY_ITEMS);
  });

  it('keeps Goals out of the desktop primary navigation in V2', () => {
    expect(getNavItems().map((i) => i.path)).not.toContain('/goals');
    expect(getNavItems().map((i) => i.labelKey)).not.toContain('nav.goals');
  });

  it('keeps secondary parent areas out of the desktop primary route list', () => {
    expect(getNavItems().map((i) => i.path)).not.toContain('/pet-box');
    expect(getNavItems().map((i) => i.path)).not.toContain('/wallets');
  });

  it('maps every primary item to a valid route path', () => {
    const items = getNavItems();
    const expectedPaths = ['/', '/tasks', '/rewards', '/family'];
    expect(items.map((i) => i.path)).toEqual(expectedPaths);
    for (const item of items) {
      expect(typeof item.path).toBe('string');
      expect(item.path.length).toBeGreaterThan(0);
    }
  });

  it('keeps the mobile bottom navigation at four routes around the central action', () => {
    expect(getQuekiNavItems().map(item => item.labelKey)).toEqual(EXPECTED_PRIMARY_ITEMS);
    expect(getQuekiNavItems().map(item => item.path)).toEqual(['/', '/tasks', '/rewards', '/family']);
  });

  it('keeps Goals out of the Queki mobile bottom navigation in V2', () => {
    expect(getQuekiNavItems().map(item => item.path)).not.toContain('/goals');
    expect(getQuekiNavItems().map(item => item.labelKey)).not.toContain('nav.goals');
  });
});
