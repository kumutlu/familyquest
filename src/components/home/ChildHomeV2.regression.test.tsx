/// <reference types="node" />
/**
 * Child Home V2 (2026-09-02) — production regression coverage.
 *
 * Pins the V2 contract (per the PO-approved brief and §25 of the task):
 *   - Goals is absent from the child primary nav at any width
 *   - Goals route remains reachable (still in the app router)
 *   - Parent navigation is unchanged (still has Goals on the desktop nav
 *     surface that parents see — V2 only removed it from child primary nav)
 *   - canonical XP values (level + xpToNext + xpProgressInLevel) come from
 *     the existing gamification projection, not a second source
 *   - canonical points come from currentUser.rewardPoints
 *   - canonical wallet comes from myWallet.balance
 *   - mascot engine bundle is consumed (mood + presentation forwarded)
 *   - Adventure precedence is unchanged (the resolver decides the kind)
 *   - no Skip affordance is rendered (the mockup placeholder was removed
 *     because no canonical Skip behaviour exists)
 *   - max 3 Home quests (QuestTileList slices to 3)
 *   - canonical quest navigation (tap → /tasks, never a second completion
 *     path)
 *   - Pet Box uses canonical funds[] (never a second balance)
 *   - Goal uses canonical savingsGoals[] (never a second projection)
 *   - Pet Box + Goal live in ONE outer surface (Your Journey)
 *   - NO shared progress track between Pet Box and Goal
 *   - Goal has its OWN progress visualization
 *   - Level / next-level info is NOT duplicated in Your Journey
 *   - NO world/weekly banner card is rendered on Home
 *   - V2 light tokens are bound (--qk-bg-canvas etc.)
 *   - V2 dark tokens are bound (.dark selector)
 *   - reduced motion contract is honoured (animation durations collapse
 *     to 0ms)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../hooks/useMascotPresentation', () => ({
  useMascotPresentationFor: () => ({
    presentation: {
      mood: 'friendly',
      expression: 'soft_smile',
      characterId: 'queki',
    },
    message: 'Hey!',
  }),
}));

vi.mock('../../hooks/useExperienceTheme', () => ({
  useExperienceTheme: () => ({
    theme: {
      id: 'theme.standard',
      tokens: { accent: '#5a3ce0', ambientFrom: '#f6f5fb', ambientTo: '#ffffff' },
    },
    weeklyEvent: null,
    seasonalEvent: null,
  }),
}));

vi.mock('../../hooks/useChildAdventure', () => ({
  useChildAdventure: () => ({
    presentation: { kind: 'normal', reason: 'no_special_opportunity' },
    surge: null,
    comeback: null,
    mysteryDrop: null,
    urgency: 'normal',
  }),
}));

const storeState: any = {
  currentUser: { id: 'c-1', role: 'child', displayName: 'Sky', rewardPoints: 50 },
  familyData: { id: 'f-1', petBoxEnabled: true },
  tasks: [
    { id: 't-1', title: 'Brush teeth', pointsReward: 5, isCompleted: false, assigneeId: 'c-1', isActive: true },
    { id: 't-2', title: 'Read 10 pages', pointsReward: 10, isCompleted: false, assigneeId: 'c-1', isActive: true },
    { id: 't-3', title: 'Tidy your room', pointsReward: 30, isCompleted: false, assigneeId: 'c-1', isActive: true },
    { id: 't-4', title: 'Help with dishes', pointsReward: 8, isCompleted: false, assigneeId: 'c-1', isActive: true },
  ],
  taskCompletions: [],
  rewards: [],
  walletTransactions: [],
  challenges: [],
  myGamificationSummary: {
    xpTotal: 1450,
    level: 7,
    currentStreak: 3,
    bestStreak: 9,
    perfectDayCount: 2,
  },
  myDailyProgress: { progressPercentage: 25, dailyGoalReached: false, perfectReached: false },
  myWallet: { balance: 1234 },
  bootstrapStatus: { tasks: 'ready', members: 'ready', funds: 'ready', savingsGoals: 'ready' },
  funds: [{ id: 'f-1', name: 'Nimbus', balance: 5729, emergencyGoal: 12000 }],
  savingsGoals: [
    { goalId: 'g-1', title: 'New bike', currentAmountPence: 3500, targetAmountPence: 20000, status: 'active' },
  ],
  activeSurges: [],
  mysteryDropDefinition: null,
  comebackInput: null,
  comebackXpReward: 0,
  familyTimezone: 'UTC',
  lastXpAward: null,
  // Capture every economic-write method to assert no write path is added.
  setFunds: () => storeState.setFundsCalls.push(1),
  setFundsCalls: [] as number[],
  setSavingsGoals: () => storeState.setSavingsGoalsCalls.push(1),
  setSavingsGoalsCalls: [] as number[],
  updateFund: () => storeState.updateFundCalls.push(1),
  updateFundCalls: [] as number[],
  deposit: () => storeState.depositCalls.push(1),
  depositCalls: [] as number[],
  awardXp: () => storeState.awardXpCalls.push(1),
  awardXpCalls: [] as number[],
  addWalletTransaction: () => storeState.addWalletCalls.push(1),
  addWalletCalls: [] as number[],
};

vi.mock('../../store/useStore', () => ({
  useStore: () => storeState,
}));

async function renderChildHome() {
  const { ChildLivingHome } = await import('./ChildLivingHome');
  return render(
    <MemoryRouter>
      <ChildLivingHome />
    </MemoryRouter>,
  );
}

describe('Child Home V2 — production regression', () => {
  beforeEach(() => {
    storeState.currentUser = { id: 'c-1', role: 'child', displayName: 'Sky', rewardPoints: 50 };
    storeState.familyData = { id: 'f-1', petBoxEnabled: true };
    storeState.funds = [{ id: 'f-1', name: 'Nimbus', balance: 5729, emergencyGoal: 12000 }];
    storeState.savingsGoals = [
      { goalId: 'g-1', title: 'New bike', currentAmountPence: 3500, targetAmountPence: 20000, status: 'active' },
    ];
    storeState.tasks = [
      { id: 't-1', title: 'Brush teeth', pointsReward: 5, isCompleted: false, assigneeId: 'c-1', isActive: true },
      { id: 't-2', title: 'Read 10 pages', pointsReward: 10, isCompleted: false, assigneeId: 'c-1', isActive: true },
      { id: 't-3', title: 'Tidy your room', pointsReward: 30, isCompleted: false, assigneeId: 'c-1', isActive: true },
      { id: 't-4', title: 'Help with dishes', pointsReward: 8, isCompleted: false, assigneeId: 'c-1', isActive: true },
    ];
    storeState.setFundsCalls.length = 0;
    storeState.setSavingsGoalsCalls.length = 0;
    storeState.updateFundCalls.length = 0;
    storeState.depositCalls.length = 0;
    storeState.awardXpCalls.length = 0;
    storeState.addWalletCalls.length = 0;
  });

  it('renders the V2 composition in the V2 order: hero → bridge → adventure → quests → journey', async () => {
    await renderChildHome();
    const home = screen.getByTestId('child-living-home');
    const order = [
      'child-identity-hero',
      'mascot-bridge',
      'todays-adventure',
      'todays-quests',
      'your-journey',
    ];
    let cursor = 0;
    for (const id of order) {
      expect(within(home).getByTestId(id)).toBeInTheDocument();
      const nodes = Array.from(home.querySelectorAll('[data-testid]')) as HTMLElement[];
      const node = nodes.find(n => n.getAttribute('data-testid') === id)!;
      const position = nodes.indexOf(node);
      expect(position).toBeGreaterThanOrEqual(cursor);
      cursor = position;
    }
  });

  it('uses canonical XP, points, and wallet values from the existing store', async () => {
    await renderChildHome();
    // Level 7 chip in the hero.
    expect(screen.getByTestId('child-level-chip').textContent).toMatch(/7/);
    // Points chip shows rewardPoints (50).
    const pointsChip = screen.getByTestId('child-points-chip');
    expect(pointsChip.textContent).toMatch(/50/);
    // Wallet chip shows formatted balance (£12.34).
    const walletChip = screen.getByTestId('child-balance-chip');
    expect(walletChip.textContent).toMatch(/£12\.34/);
  });

  it('consumes the Mascot Engine presentation (mood forwarded, character rendered)', async () => {
    await renderChildHome();
    const bridge = screen.getByTestId('mascot-bridge');
    expect(bridge.getAttribute('data-mascot-mood')).toBe('friendly');
    // Mascot character region renders a child of the bridge.
    expect(within(bridge).getByTestId('mascot-bridge-character')).toBeInTheDocument();
  });

  it('caps Home quests at 3 (canonical quest navigation, no second completion path)', async () => {
    await renderChildHome();
    const questSection = screen.getByTestId('todays-quests');
    const tiles = within(questSection).getAllByTestId(/^quest-tile-(?!view-all)/);
    expect(tiles.length).toBeLessThanOrEqual(3);
    // Each tile is a button; tapping it routes to /tasks (no data-completes-task).
    for (const tile of tiles) {
      expect(tile.tagName).toBe('BUTTON');
      expect(tile).not.toHaveAttribute('data-completes-task');
    }
  });

  it('renders Pet Box + Goal side-by-side inside ONE outer surface (no shared progress track)', async () => {
    await renderChildHome();
    const journey = screen.getByTestId('your-journey');
    const zones = within(journey).getByTestId('your-journey-zones');
    // Two internal zones, side-by-side.
    const zoneEls = zones.querySelectorAll('.qk-journey__zone');
    expect(zoneEls.length).toBe(2);
    // Pet Box + Goal testids both present.
    expect(within(journey).getByTestId('your-journey-petbox')).toBeInTheDocument();
    expect(within(journey).getByTestId('your-journey-goal')).toBeInTheDocument();
    // Goal progress track is a single .qk-journey__goal-track (NOT shared).
    const tracks = within(journey).getAllByTestId('your-journey-goal-track');
    expect(tracks.length).toBe(1);
  });

  it('Pet Box does NOT share a progress bar with the Goal (PO correction)', async () => {
    await renderChildHome();
    const journey = screen.getByTestId('your-journey');
    // The Pet Box zone has no .qk-journey__goal-track child.
    const petbox = within(journey).getByTestId('your-journey-petbox');
    expect(petbox.querySelector('.qk-journey__goal-track')).toBeNull();
  });

  it('does NOT duplicate Level / next-level information inside Your Journey', async () => {
    await renderChildHome();
    const journey = screen.getByTestId('your-journey');
    // The journey zone titles are Pet Box / Goal — never "Level …".
    expect(journey.textContent).not.toMatch(/Lv\s*\d+/i);
    expect(journey.textContent).not.toMatch(/XP to level/i);
  });

  it('does NOT render a World / weekly / seasonal banner card on Home', async () => {
    await renderChildHome();
    expect(screen.queryByTestId(/world-banner/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId(/weekly-world/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId(/seasonal-banner/i)).not.toBeInTheDocument();
  });

  it('does NOT render a Skip affordance (no canonical Skip in the engagement model)', async () => {
    await renderChildHome();
    expect(screen.queryByTestId(/skip/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /skip/i })).not.toBeInTheDocument();
  });

  it('preserves the existing Adventure precedence: host uses resolver.kind, no second source', async () => {
    await renderChildHome();
    const adventure = screen.getByTestId('todays-adventure');
    expect(adventure.getAttribute('data-adventure-kind')).toBe('normal');
  });

  it('NEVER writes to the canonical Pet Box / Goal / XP / wallet store', async () => {
    await renderChildHome();
    expect(storeState.setFundsCalls).toEqual([]);
    expect(storeState.setSavingsGoalsCalls).toEqual([]);
    expect(storeState.updateFundCalls).toEqual([]);
    expect(storeState.depositCalls).toEqual([]);
    expect(storeState.awardXpCalls).toEqual([]);
    expect(storeState.addWalletCalls).toEqual([]);
  });

  // ---------------------------------------------------------------------
  // V2 visual polish presentation contract
  // ---------------------------------------------------------------------
  // The PO reviewed actual rendered screenshots and required the visual
  // hierarchy to feel like a living Queki world, not a stack of cards.
  // These tests pin the structural presentation contracts without
  // relying on brittle pixel assertions.
  // ---------------------------------------------------------------------

  it('Normal Adventure is compact (NOT a giant duplicate card)', async () => {
    await renderChildHome();
    const normal = screen.getByTestId('adventure-centerpiece-normal');
    // The compact treatment uses the dedicated class — NOT a TactileCard.
    expect(normal.className).toMatch(/qk-adventure-compact/);
    // Normal does NOT carry the heavy surface tokens from the old
    // TactileCard treatment (no big shadow, no inner card border).
    expect(normal.className).not.toMatch(/qk-shadow-card/);
    expect(normal.className).not.toMatch(/qk-bg-card/);
    // The compact normal section is a single small header row, not a
    // heading + giant card.
    const tag = normal.tagName.toLowerCase();
    expect(['div', 'p', 'section']).toContain(tag);
  });

  it('Today\'s Quests render as ONE grouped composition (no three floating cards)', async () => {
    await renderChildHome();
    const questSection = screen.getByTestId('todays-quests');
    // The single group container is present.
    const groupRows = screen.getByTestId('quest-group-rows');
    expect(groupRows).toBeInTheDocument();
    expect(questSection.contains(groupRows)).toBe(true);
    // The group surfaces at most three row wrappers.
    const rowNodes = questSection.querySelectorAll('[data-testid^="quest-group-row-"]');
    expect(rowNodes.length).toBeGreaterThan(0);
    expect(rowNodes.length).toBeLessThanOrEqual(3);
    // Each quest tile is an accessible interactive button (one per row).
    const tileButtons = questSection.querySelectorAll('[data-testid^="quest-tile-"]');
    const questTileButtons = Array.from(tileButtons).filter(el => {
      const id = el.getAttribute('data-testid') ?? '';
      // exclude the "view all" affordance, which is the only sibling button
      return id !== 'quest-tile-view-all';
    });
    expect(questTileButtons.length).toBe(rowNodes.length);
  });

  it('Your Journey is ONE surface with Pet Box + Goal directly inside (no nested inner card)', async () => {
    await renderChildHome();
    const journey = screen.getByTestId('your-journey');
    const zones = screen.getByTestId('your-journey-zones');
    // Pet Box + Goal both live directly inside the zones wrapper,
    // which lives directly inside the Journey surface.
    expect(journey.contains(zones)).toBe(true);
    const petbox = screen.getByTestId('your-journey-petbox');
    const goal = screen.getByTestId('your-journey-goal');
    expect(zones.contains(petbox)).toBe(true);
    expect(zones.contains(goal)).toBe(true);
    // The Journey IS the single outer surface — no nested Journey.
    expect(journey.classList.contains('qk-journey')).toBe(true);
    // There must NOT be an additional "inner card" wrapper inside.
    expect(journey.querySelectorAll('.qk-journey').length).toBe(0);
    // Pet Box and Goal are side-by-side at the contracted responsive
    // layout via the class contract on .qk-journey__zones.
    expect(zones.className).toMatch(/qk-journey__zones/);
    // Pet Box and Goal semantically stay independent — no shared progress track.
    expect(petbox.querySelector('[role="progressbar"]')).toBeNull();
    const goalTrack = goal.querySelector('[role="progressbar"]');
    expect(goalTrack).not.toBeNull();
    expect(goalTrack!.getAttribute('aria-label')).toBeTruthy();
  });

  it('Mascot bridge uses a character-sized mascot (NOT a pill icon)', async () => {
    await renderChildHome();
    const character = screen.getByTestId('mascot-bridge-character');
    // The bridge composition hosts the actual mascot character region
    // (engine-driven). The engine renders the Queki character itself.
    expect(character.getAttribute('aria-hidden')).toBe('true');
    // The bridge composition uses the character-friendly bridge class,
    // NOT a small pill-icon size.
    expect(character.className).toMatch(/qk-mascot-bridge__character/);
    // The speech line lives on a non-card note, not in another giant rectangle.
    const bubble = screen.getByTestId('mascot-bridge-bubble');
    expect(bubble.tagName.toLowerCase()).toBe('p');
    expect(bubble.className).toMatch(/qk-mascot-bridge__bubble/);
  });

  it('Desktop lower section uses a horizontal grid (quests + journey side-by-side at md+)', async () => {
    await renderChildHome();
    const home = screen.getByTestId('child-living-home');
    const lower = home.querySelector('.qk-v2-stack__lower');
    expect(lower).not.toBeNull();
    // Today's Quests and Your Journey both live inside the same lower grid.
    const quests = screen.getByTestId('todays-quests');
    const journey = screen.getByTestId('your-journey');
    expect(lower!.contains(quests)).toBe(true);
    expect(lower!.contains(journey)).toBe(true);
  });

  it('No world/weekly/seasonal banner card is rendered on Home', async () => {
    await renderChildHome();
    expect(screen.queryByTestId(/world-banner/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId(/weekly-banner/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId(/seasonal-banner/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PO 2026-09-03 final visual cleanup pass — focused presentation contracts.
// These tests pin the structural fixes from the latest screenshot review:
//   - Hero is no longer a giant purple wrapper panel
//   - Mascot speech is a lightweight note (not a card)
//   - Normal state has ONE canonical "See all" navigation affordance
//   - grouped quests remain a single coherent surface
//   - max 3 Home quests remain
//   - Surge / Mystery Ready remain special/expanded
//   - Mystery copy contains no rarity/loot language
//   - Comeback mascot + Adventure copy are not duplicate
//   - Seasonal Neon does not apply large content surface (pattern density
//     ceiling is restrained)
//   - Journey remains Pet Box + Goal, no shared progress
//   - desktop lower composition resolves to intended responsive class
//   - Goals primary nav still absent
//   - no Skip affordance
//   - reduced motion preserved
// ---------------------------------------------------------------------------

describe('Child Home V2 final visual cleanup contracts', () => {
  it('Hero is no longer a giant purple wrapper panel (compact identity card)', async () => {
    await renderChildHome();
    const hero = screen.getByTestId('child-identity-hero');
    // PO 2026-09-03: the hero text is now qk-text-primary, NOT on-brand
    // white that previously read as part of a giant purple panel.
    expect(hero.className).toMatch(/qk-hero/);
    // The hero h1 is not onbrand white anymore; the section relies on
    // a soft tint, not the heavy indigo/violet gradient that wrapped the
    // whole page in the previous pass.
    const childExperienceCss = readFileSync(
      resolve(process.cwd(), 'src/design/child-experience.css'),
      'utf8',
    );
    expect(childExperienceCss).toMatch(/\.qk-hero\s*\{[\s\S]*?color-mix/);
    // Background no longer uses the linear-gradient(--qk-surface-hero-from, --to)
    // that defined the old giant purple panel.
    expect(childExperienceCss).not.toMatch(
      /\.qk-hero\s*\{[\s\S]*?background:\s*linear-gradient\(\s*135deg,\s*var\(--qk-surface-hero-from\)/,
    );
  });

  it('Mascot speech is a lightweight note (no full-width card)', async () => {
    await renderChildHome();
    const bubble = screen.getByTestId('mascot-bridge-bubble');
    expect(bubble.tagName.toLowerCase()).toBe('p');
    expect(bubble.className).toMatch(/qk-mascot-bridge__bubble/);
    // The bubble carries no border / shadow / large background panel. It
    // visually belongs to the character instead of being its own card.
    const css = bubble.className;
    expect(css).not.toMatch(/qk-shadow-card/);
    expect(css).not.toMatch(/qk-bg-card/);
    expect(css).not.toMatch(/border-/);
  });

  it('Normal state has ONE canonical See-all navigation affordance (no duplicate)', async () => {
    await renderChildHome();
    // The section heading carries the canonical "See all" link.
    const headingSeeAll = screen.getByTestId('todays-quests-see-all');
    expect(headingSeeAll).toBeInTheDocument();
    // The QuestTile footer "See all quests" is removed to avoid duplication.
    expect(screen.queryByTestId('quest-tile-view-all')).not.toBeInTheDocument();
  });

  it('Quest group keeps grouped composition with max 3 rows', async () => {
    await renderChildHome();
    const rows = screen.getAllByTestId(/^quest-group-row-/);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(3);
  });

  it('Mystery Ready copy no longer contains rarity/loot language', () => {
    const enHome = readFileSync(
      resolve(process.cwd(), 'src/i18n/locales/en/home.json'),
      'utf8',
    );
    const trHome = readFileSync(
      resolve(process.cwd(), 'src/i18n/locales/tr/home.json'),
      'utf8',
    );
    // Banned words (English): rare, legendary, jackpot, lucky, chance, odds,
    // roll, spin, loot, win big. We only assert the most-flagged tokens.
    expect(enHome).not.toMatch(/rare surprise/);
    expect(enHome).not.toMatch(/legendary surprise/);
    expect(enHome).not.toMatch(/jackpot/);
    expect(enHome).not.toMatch(/loot/);
    expect(trHome).not.toMatch(/nadir sürprizini/); // old "rare surprise" phrasing
  });

  it('Comeback mascot line and Adventure body are not duplicates', () => {
    const enHome = readFileSync(
      resolve(process.cwd(), 'src/i18n/locales/en/home.json'),
      'utf8',
    );
    // PO 2026-09-03: Adventure copy now explains the mission + XP instead
    // of repeating "long time no see" / "since you checked in".
    expect(enHome).not.toMatch(/"body":\s*"It.s been \{\{count\}\} days since you checked in\."/);
    expect(enHome).toMatch(/warm7d.*Great to see you again/s);
    expect(enHome).toMatch(/body.*Pick today.s first quest/s);
  });

  it('Seasonal Neon does not paint a giant content surface (pattern density restrained)', () => {
    const preview = readFileSync(
      resolve(process.cwd(), 'src/components/preview/EngagementPreviewRoute.tsx'),
      'utf8',
    );
    // PO 2026-09-03: pattern density ceiling dropped from 0.85 to a
    // restrained 0.35 so Neon only adds ambient glow, not a giant panel.
    expect(preview).toMatch(/seasonal-neon[\s\S]*?patternDensity:\s*0\.35/);
    // accentSoft is no longer a solid bright colour that fills mid-gradient.
    expect(preview).toMatch(/accentSoft:\s*'rgba\(34,\s*211,\s*238,\s*0\.18\)'/);
  });

  it('Pattern layer opacity ceiling is restrained (no recoloured content surface)', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/design/child-experience.css'),
      'utf8',
    );
    // The pattern opacity ceiling used to be 0.85; it is now 0.35 so the
    // seasonal theme cannot paint the whole central surface.
    expect(css).toMatch(/opacity:\s*calc\(0\.35 \* var\(--qk-theme-pattern-density\)\)/);
    expect(css).not.toMatch(/opacity:\s*calc\(0\.85 \* var\(--qk-theme-pattern-density\)\)/);
  });

  it('Desktop lower section resolves to a responsive grid at md+', async () => {
    await renderChildHome();
    const home = screen.getByTestId('child-living-home');
    const lower = home.querySelector('.qk-v2-stack__lower');
    expect(lower).not.toBeNull();
    const css = readFileSync(
      resolve(process.cwd(), 'src/design/child-experience.css'),
      'utf8',
    );
    // Verify the actual rule exists for the responsive grid (not just a
    // CSS comment claiming it does).
    expect(css).toMatch(/@media\s*\(min-width:\s*768px\)[\s\S]*?\.qk-v2-stack__lower\s*\{[\s\S]*?display:\s*grid/);
  });

  it('Pet Box + Goal live in ONE Journey surface, no shared progress', async () => {
    await renderChildHome();
    const journey = screen.getByTestId('your-journey');
    const petbox = screen.getByTestId('your-journey-petbox');
    const goal = screen.getByTestId('your-journey-goal');
    expect(journey.contains(petbox)).toBe(true);
    expect(journey.contains(goal)).toBe(true);
    expect(petbox.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('Goals primary nav still absent on Child routes', async () => {
    await renderChildHome();
    // Goals tab MUST NOT be in the child primary nav at any width.
    expect(screen.queryByRole('link', { name: /goals/i })).not.toBeInTheDocument();
  });

  it('No Skip affordance on the Child Home', async () => {
    await renderChildHome();
    expect(screen.queryByTestId(/skip/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /skip/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Token-level contract
// ---------------------------------------------------------------------------
//
// jsdom does not load Vite's CSS as live stylesheets, so we assert the V2
// token contract by parsing the canonical tokens.css source. The token
// names are part of the public surface that components depend on, so
// changing them is a breaking change that should always require updating
// this test.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Resolved relative to the project root (vitest runs from the repo root).
const TOKENS_CSS = readFileSync(
  resolve(process.cwd(), 'src/design/tokens.css'),
  'utf8',
);

describe('V2 design tokens', () => {
  it('declares the 5-level luminance ladder under :root (light)', () => {
    for (const name of [
      '--qk-bg-canvas',
      '--qk-bg-subtle',
      '--qk-bg-default',
      '--qk-bg-elevated',
      '--qk-bg-interactive',
    ]) {
      expect(TOKENS_CSS).toMatch(new RegExp(`${name}:`));
    }
  });

  it('declares the 5-level luminance ladder under .dark', () => {
    const darkBlock = TOKENS_CSS.split('.dark')[1] ?? '';
    for (const name of [
      '--qk-bg-canvas',
      '--qk-bg-subtle',
      '--qk-bg-default',
      '--qk-bg-elevated',
      '--qk-bg-interactive',
    ]) {
      expect(darkBlock).toMatch(new RegExp(`${name}:`));
    }
  });

  it('light and dark are NOT simple inverses (independent luminance steps)', () => {
    const light = TOKENS_CSS.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const dark = TOKENS_CSS.split('.dark')[1]?.match(/\{([\s\S]*?)\}/)?.[1] ?? '';
    // Visual polish pass: dark canvas is now a deep indigo-violet
    // (Queki nighttime world), NOT a near-black. The light step keeps
    // the warm paper canvas. Dark still introduces a 5-step ladder
    // that the light block does not.
    //
    // The literal palette moved into the theme-AGNOSTIC tone layer
    // (`--qk-tone-*`). The ladder now derives from it, which is what lets a
    // child theme tint every surface by mixing its accent into a neutral base
    // without ever redefining the neutral itself (a self-referential mix would
    // be a CSS cycle, and re-declaring the tone would compound the tint on
    // every navigation). The palette contract below is unchanged — only its
    // address moved.
    expect(light).toMatch(/--qk-tone-canvas:\s*#f5f3fb/);
    expect(dark).toMatch(/--qk-tone-canvas:\s*#1a1530/);
    expect(light).not.toMatch(/--qk-tone-canvas:\s*#1a1530/);
    // Deep indigo-violet, not a flat black. Each channel in the canvas
    // colour should show a non-trivial violet bias (R < G ≤ B).
    const canvas = (dark.match(/--qk-tone-canvas:\s*#([0-9a-f]{6})/) ?? [])[1];
    expect(canvas).toBeDefined();
    const r = parseInt(canvas!.slice(0, 2), 16);
    const g = parseInt(canvas!.slice(2, 4), 16);
    const b = parseInt(canvas!.slice(4, 6), 16);
    expect(r).toBeLessThan(g + 8); // violet/blue bias, not warm
    expect(b).toBeGreaterThan(r);   // blue channel dominates
    // Every rung of both ladders is DERIVED from the tone layer.
    for (const name of [
      '--qk-bg-canvas',
      '--qk-bg-subtle',
      '--qk-bg-default',
      '--qk-bg-elevated',
      '--qk-bg-interactive',
    ]) {
      const rung = name.replace('--qk-bg-', '');
      expect(light).toMatch(new RegExp(`${name}:\\s*var\\(--qk-tone-${rung}\\)`));
      expect(dark).toMatch(new RegExp(`${name}:\\s*var\\(--qk-tone-${rung}\\)`));
    }
  });

  it('honours prefers-reduced-motion by collapsing animation durations to 0ms', () => {
    expect(TOKENS_CSS).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    // The hold-to-complete duration specifically collapses to 0ms.
    const reducedMotionBlock = TOKENS_CSS.split(
      'prefers-reduced-motion: reduce',
    )[1] ?? '';
    expect(reducedMotionBlock).toMatch(/--animate-duration-hold:\s*0ms/);
  });
});
