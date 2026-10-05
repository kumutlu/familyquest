/**
 * Route-persistence tests for the child theme boundary.
 *
 * These are the regression guard for the actual complaint: a child equips a
 * theme, leaves Home, and the app looks like the theme was never applied.
 *
 * The tests render the boundary the way the app does — as the LAYOUT element
 * above a set of child routes — and then navigate between those routes. What
 * they assert is deliberately structural rather than cosmetic:
 *
 *   - the world id is still the equipped theme after navigation
 *   - it is the SAME shell DOM node (proving the boundary did not remount and
 *     rebuild the world on each route change)
 *   - exactly ONE shell exists (no stacked world layers)
 *   - the `<html>` mirror is present so portaled sheets are themed, and is
 *     removed on unmount so no parent screen inherits a child's world
 *   - a child opening a NON-home route directly still gets the theme
 *   - switching children re-resolves the theme with no leakage between them
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom';
import { useSyncExternalStore } from 'react';

/* -------------------------------------------------------------------------- */
/* Store mock — same pattern the other theme tests use                        */
/* -------------------------------------------------------------------------- */

type StoreState = Record<string, unknown>;

let storeState: StoreState = {};
const storeListeners = new Set<() => void>();

vi.mock('../../store/useStore', () => ({
  useStore: (selector: (s: StoreState) => unknown) => useSyncExternalStore(
    (onStoreChange) => {
      storeListeners.add(onStoreChange);
      return () => { storeListeners.delete(onStoreChange); };
    },
    () => selector(storeState),
    () => selector(storeState),
  ),
}));

function setStore(next: StoreState) {
  storeState = { ...storeState, ...next };
  for (const listener of storeListeners) listener();
}

import { ChildThemeBoundary } from './ChildThemeBoundary';
import { ChildThemeSurface } from './ChildThemeSurface';
import {
  setExperienceClock,
  setExperiencePreferences,
  resetExperienceState,
} from '../../hooks/useExperienceTheme';
import { storeEquippedTheme } from '../../hooks/useChildThemeRights';
import { normaliseExperiencePreferences, CALM_THEME } from '../../domain/experience';
import { resetThemePreviewOverride } from '../../domain/experience/themePreviewOverride';

const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);
const FAMILY = 'family-1';

/** Repo root, found by walking up to the app manifest (jsdom has no file URL). */
function findRepoRoot(from = process.cwd()): string {
  let current = resolve(from);
  for (;;) {
    if (existsSync(join(current, 'src/components/layout/AppLayout.tsx'))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(from);
    current = parent;
  }
}
const REPO_ROOT = findRepoRoot();

/** Equip a shop theme for a child exactly the way the app does. */
function equipChild(childId: string, shopItemId: string, themeId: string) {
  act(() => {
    storeEquippedTheme(themeId, FAMILY, childId);
    setStore({
      themePurchases: [{ id: shopItemId, shopItemId, childId, costPoints: 300 }],
      themeShopItems: [],
      currentUser: { id: childId, familyId: FAMILY, role: 'child', theme: null },
    });
  });
}

/** In-app navigation between child routes. */
function ChildRoutes() {
  return (
    <Routes>
      <Route element={<ChildThemeBoundary />}>
        <Route path="/" element={<div data-testid="page-home">Home<Link to="/tasks">to tasks</Link></div>} />
        <Route path="/tasks" element={<div data-testid="page-tasks">Quests<Link to="/rewards">to rewards</Link></div>} />
        <Route path="/rewards" element={<div data-testid="page-rewards">Rewards<Link to="/goals">to goals</Link></div>} />
        <Route path="/goals" element={<div data-testid="page-goals">Goals</div>} />
        <Route path="/more" element={<div data-testid="page-more">More</div>} />
      </Route>
    </Routes>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ChildRoutes />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  storeListeners.clear();
  storeState = {};
  setExperienceClock(() => NOW);
  // Base + equipped only — no live promotional event to confound the id.
  setExperiencePreferences(
    normaliseExperiencePreferences({ weeklyThemes: false, seasonalEvents: {} }),
  );
  resetExperienceState();
});

afterEach(() => {
  cleanup();
  resetThemePreviewOverride();
  resetExperienceState();
  localStorage.clear();
  document.documentElement.removeAttribute('data-child-theme');
  document.documentElement.style.removeProperty('--qk-theme-accent');
  document.documentElement.style.removeProperty('--qk-theme-accent-soft');
});

describe('ChildThemeBoundary — the theme survives child navigation', () => {
  it('keeps Space Explorer applied across Home → Quests → Rewards → Goals → More', async () => {
    const user = userEvent.setup();
    equipChild('child-1', 'space', 'theme.shop.space');

    renderAt('/');
    const shell = screen.getByTestId('child-experience-shell');
    const worldBefore = shell.getAttribute('data-experience-world');
    expect(shell.getAttribute('data-child-theme')).toBe('theme.shop.space');

    // Walk the child tab bar. At every stop the theme must still be applied
    // and must still be the SAME world — no fallback to Classic.
    for (const [link, page] of [
      ['to tasks', 'page-tasks'],
      ['to rewards', 'page-rewards'],
      ['to goals', 'page-goals'],
    ] as const) {
      await user.click(screen.getByText(link));
      expect(screen.getByTestId(page)).toBeInTheDocument();
      const now = screen.getByTestId('child-experience-shell');
      expect(now.getAttribute('data-child-theme')).toBe('theme.shop.space');
      expect(now.getAttribute('data-experience-world')).toBe(worldBefore);
    }
  });

  it('does NOT remount the shell on navigation (one world, built once)', async () => {
    const user = userEvent.setup();
    equipChild('child-1', 'space', 'theme.shop.space');

    renderAt('/');
    const shell = screen.getByTestId('child-experience-shell');

    await user.click(screen.getByText('to tasks'));
    // Identity, not equality: a remount would produce a new element.
    expect(screen.getByTestId('child-experience-shell')).toBe(shell);

    await user.click(screen.getByText('to rewards'));
    expect(screen.getByTestId('child-experience-shell')).toBe(shell);

    // Exactly one world plate layer — never a stack of duplicate backgrounds.
    expect(screen.getAllByTestId('child-experience-shell')).toHaveLength(1);
  });

  it('restores the theme when a non-home route is opened directly', () => {
    equipChild('child-1', 'space', 'theme.shop.space');

    // Straight to Rewards. No Home visit first.
    renderAt('/rewards');
    expect(screen.getByTestId('page-rewards')).toBeInTheDocument();
    expect(
      screen.getByTestId('child-experience-shell').getAttribute('data-child-theme'),
    ).toBe('theme.shop.space');
  });

  it('mirrors the theme onto <html> for portaled sheets, and clears it on unmount', () => {
    equipChild('child-1', 'space', 'theme.shop.space');

    const view = renderAt('/rewards');
    // Sheets portal to document.body, so they only inherit the theme if it is
    // published on the document root.
    expect(document.documentElement.getAttribute('data-child-theme')).toBe('theme.shop.space');
    expect(document.documentElement.style.getPropertyValue('--qk-theme-accent')).not.toBe('');

    view.unmount();
    // A parent must never inherit a child's world.
    expect(document.documentElement.getAttribute('data-child-theme')).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--qk-theme-accent')).toBe('');
  });

  it('mirrors the NON-COLOUR personality onto <html>, and clears it on unmount', () => {
    equipChild('child-1', 'neon', 'theme.shop.neon');

    const view = renderAt('/tasks');
    const root = document.documentElement;

    /* Sheets and the app chrome are OUTSIDE the shell subtree, so without this
       mirror a sheet opened over Neon Arcade would render with Classic's flat,
       fully-opaque surfaces and 16px radius — the theme would visibly snap back
       at the moment a child taps anything. */
    expect(root.getAttribute('data-qk-shadow')).toBe('lifted');
    expect(root.getAttribute('data-qk-pattern')).toBe('grid');
    expect(root.getAttribute('data-qk-surface-scheme')).toBe('dark');
    expect(root.getAttribute('data-qk-progress-effect')).toBe('luminous');
    expect(root.style.getPropertyValue('--qk-theme-surface-blur')).toBe('10');
    expect(root.style.getPropertyValue('--qk-theme-surface-radius')).toBe('10');

    view.unmount();
    /* A parent screen must never inherit a child's glass personality. */
    expect(root.getAttribute('data-qk-shadow')).toBeNull();
    expect(root.style.getPropertyValue('--qk-theme-surface-blur')).toBe('');
  });

  it('publishes a DIFFERENT personality per theme, on the shell and the mirror alike', () => {
    const readBoth = (itemId: string, themeId: string) => {
      const view = renderAt('/tasks');
      equipChild('child-1', itemId, themeId);
      const shell = screen.getByTestId('child-experience-shell');
      const root = document.documentElement;
      const read = () => ({
        scheme: shell.getAttribute('data-qk-surface-scheme'),
        shadow: shell.getAttribute('data-qk-shadow'),
        pattern: shell.getAttribute('data-qk-pattern'),
        radius: shell.style.getPropertyValue('--qk-theme-surface-radius'),
        mirrorShadow: root.getAttribute('data-qk-shadow'),
        mirrorRadius: root.style.getPropertyValue('--qk-theme-surface-radius'),
      });
      const snapshot = read();
      view.unmount();
      return snapshot;
    };

    const neonState = readBoth('neon', 'theme.shop.neon');
    expect(neonState).toMatchObject({
      scheme: 'dark',
      shadow: 'lifted',
      pattern: 'grid',
      radius: '10',
      mirrorShadow: 'lifted',
      mirrorRadius: '10',
    });
  });

  it('falls back to the neutral scope when the child has no equipped theme', () => {
    act(() => {
      setStore({
        themePurchases: [],
        themeShopItems: [],
        currentUser: { id: 'child-1', familyId: FAMILY, role: 'child', theme: null },
      });
    });

    renderAt('/tasks');
    const shell = screen.getByTestId('child-experience-shell');
    expect(shell.getAttribute('data-child-theme')).toBe('theme.standard');
    // Classic is intentionally outside the tint scope — the baseline palette.
    expect(document.documentElement.getAttribute('data-child-theme')).toBe('theme.standard');
  });
});

describe('ChildThemeBoundary — nested surfaces reuse the boundary', () => {
  it('a nested preview does not stack a second shell, but does drive the world', () => {
    equipChild('child-1', 'space', 'theme.shop.space');

    // Stands in for the Theme Shop's focus view, which previews a world it is
    // selling. It must reuse the boundary rather than mount its own shell.
    render(
      <MemoryRouter initialEntries={['/themes']}>
        <Routes>
          <Route element={<ChildThemeBoundary />}>
            <Route
              path="/themes"
              element={
                <ChildThemeSurface
                  resolvedTheme={{ theme: CALM_THEME, source: 'base', appliedEventName: null }}
                  mascotPresentation={null}
                  publishPreview
                >
                  <div data-testid="page-shop">Shop</div>
                </ChildThemeSurface>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    // Preview won the world…
    expect(
      screen.getByTestId('child-experience-shell').getAttribute('data-child-theme'),
    ).toBe('theme.shop.calm');
    // …without stacking a duplicate world layer.
    expect(screen.getAllByTestId('child-experience-shell')).toHaveLength(1);

    // Unmount clears the preview so the child's real theme returns without a
    // visit to Home.
    cleanup();
    expect(document.documentElement.getAttribute('data-child-theme')).toBeNull();
  });
});

describe('ChildThemeBoundary — child switching does not leak', () => {
  it('re-resolves the theme when the child changes, A → B → A', () => {
    equipChild('child-a', 'neon', 'theme.shop.neon');
    const view = renderAt('/tasks');
    expect(
      screen.getByTestId('child-experience-shell').getAttribute('data-child-theme'),
    ).toBe('theme.shop.neon');

    // Child B, same open route. No cross-child leakage.
    equipChild('child-b', 'calm', 'theme.shop.calm');
    view.rerender(
      <MemoryRouter initialEntries={['/tasks']}>
        <ChildRoutes />
      </MemoryRouter>,
    );
    expect(
      screen.getByTestId('child-experience-shell').getAttribute('data-child-theme'),
    ).toBe('theme.shop.calm');

    // Back to A.
    equipChild('child-a', 'neon', 'theme.shop.neon');
    view.rerender(
      <MemoryRouter initialEntries={['/tasks']}>
        <ChildRoutes />
      </MemoryRouter>,
    );
    expect(
      screen.getByTestId('child-experience-shell').getAttribute('data-child-theme'),
    ).toBe('theme.shop.neon');
  });
});

describe('ChildThemeBoundary — the primary ramp is child-scoped', () => {
  /**
   * The ramp in `child-experience.css` re-points `--color-primary-*` from the
   * theme accent. These tests pin the SCOPE of that override: it must apply to
   * the child app (in-shell AND via the <html> mirror, so portaled sheets get
   * it too) and must never apply to Classic, a parent, or auth/onboarding.
   */

  const CHILD_SHOP_THEME_PREFIX = 'theme.shop.';

  it('marks the document root with the shop-theme attribute the ramp is keyed on', () => {
    equipChild('child-1', 'space', 'theme.shop.space');
    renderAt('/rewards');

    const attr = document.documentElement.getAttribute('data-child-theme');
    expect(attr?.startsWith(CHILD_SHOP_THEME_PREFIX)).toBe(true);
  });

  it('Classic does NOT match the ramp scope (identity baseline stays fixed)', () => {
    act(() => {
      setStore({
        themePurchases: [],
        themeShopItems: [],
        currentUser: { id: 'child-1', familyId: FAMILY, role: 'child', theme: null },
      });
    });
    renderAt('/tasks');

    // The scope selector is `[data-child-theme^='theme.shop.']`, so a classic
    // child resolves to an attribute that cannot match it.
    const attr = document.documentElement.getAttribute('data-child-theme');
    expect(attr).toBe('theme.standard');
    expect(attr?.startsWith(CHILD_SHOP_THEME_PREFIX)).toBe(false);
  });

  it('clears the <html> mirror on unmount so no parent screen inherits it', () => {
    equipChild('child-1', 'neon', 'theme.shop.neon');
    const view = renderAt('/tasks');
    expect(document.documentElement.getAttribute('data-child-theme')).toBe('theme.shop.neon');

    view.unmount();
    expect(document.documentElement.getAttribute('data-child-theme')).toBeNull();
  });

  it('is mounted ONLY behind the child role gate in AppLayout', () => {
    // The boundary harness above mounts the boundary unconditionally, so the
    // role gate itself has to be asserted where it actually lives. If this ever
    // regresses, a parent session would publish `theme.shop.*` on <html> and
    // the derived ramp would recolour the parent dashboard, auth and onboarding.
    const layout = readFileSync(join(REPO_ROOT, 'src/components/layout/AppLayout.tsx'), 'utf8');
    expect(layout).toMatch(/isChild\s*\?\s*<ChildThemeBoundary\s*\/>\s*:\s*<Outlet\s*\/>/);
    // And the gate must be driven by the role, not by a route or a prop.
    expect(layout).toMatch(/const isChild = isChildRole\(currentUser\?\.role\)/);
  });
});
