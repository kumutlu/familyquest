/**
 * `previewFixtures` — registry of all engagement preview fixtures.
 *
 * Pure data + a single lookup helper. Lives in its own module so the React
 * component file can stay a Fast Refresh boundary (only React components
 * exported).
 *
 * SAFETY
 * ------
 * The registry is intentionally local: it never touches Firestore, XP,
 * points, wallet, inventory, or task-completion writes. The preview is
 * fixture-only.
 *
 * CHILD EXPERIENCE V1
 * -------------------
 * Each fixture carries enough data (presentation, mystery drop, surge,
 * comeback, quests, mascot mood) for the visual canvas to render the
 * REAL product composition (MascotScene, TodaysAdventureCenterpiece,
 * QuestTileList, LongTermProgress) inside the ChildExperienceShell.
 * QA judges hierarchy and theme, not isolated text.
 */

import type { MascotExpression, MascotMood } from '../../domain/mascot';
import type { DailyAdventurePresentation } from '../../domain/adventure/presentation.v1';
import type { ComebackTier } from '../../domain/comeback/types';
import type { MysteryDropDisplay } from '../queki/TodaysAdventure';
import type { WorldId } from '../../domain/experienceWorld/types';

export type PreviewFixtureKind =
  | 'normal-quests'
  | 'normal-all-caught-up'
  | 'surge'
  | 'mystery-locked'
  | 'mystery-ready'
  | 'mystery-reveal'
  | 'comeback-1d'
  | 'comeback-3d'
  | 'comeback-7d'
  | 'seasonal-christmas'
  | 'seasonal-halloween'
  | 'seasonal-ramadan-eid'
  | 'seasonal-neon'
  | 'world-christmas-surge'
  | 'world-halloween-mystery'
  | 'world-eid-comeback'
  | 'world-normal-surge'
  | 'xp-pop-mystery'
  | 'xp-pop-comeback'
  | 'reduced-motion'

export interface PreviewFixture {
  readonly id: string
  readonly title: string
  readonly kind: PreviewFixtureKind
  /**
   * World the preview should render. When set, the preview route
   * sets the world override so the production world layer paints
   * the requested world. When omitted, the world follows the
   * resolved theme (i.e. kind-derived).
   */
  readonly worldId?: WorldId
  readonly mood: MascotMood
  readonly expression: MascotExpression
  readonly messageKey: string
  readonly mascotLine: string
  readonly adventurePresentation: DailyAdventurePresentation
  readonly mysteryDrop: MysteryDropDisplay | null
  readonly surge: {
    readonly surgeId: string
    readonly eligibleTasks: ReadonlyArray<{ id: string; title: string; pointsReward: number }>
    readonly endsAt: number
  } | null
  readonly comeback: {
    readonly tier: ComebackTier
    readonly inactivityDays: number
    readonly missionCompleted: boolean
  } | null
  readonly normalQuestCount: number
  readonly allCaughtUp: boolean
  readonly quests: ReadonlyArray<{
    readonly id: string
    readonly title: string
    readonly pointsReward: number
    readonly isCompletedToday?: boolean
    readonly onPress: (id: string) => void
  }>
  /**
   * DEV-only deterministic fixture values for the long-term band
   * (Pet Box + Goals). NEVER a write side: this data is read-only and
   * must NOT be sourced from, or written to, the canonical Pet Box /
   * Goals accounting authority.
   */
  /**
   * DEV-only deterministic fixture values for the Your Journey V2 band
   * (Pet Box + Current Goal). The V2 contract:
   *   - Pet Box has a name + balance (no progress bar).
   *   - Goal has its OWN progress (current / target, never shared with Pet Box).
   *   - These values are NEVER sourced from, or written to, the canonical
   *     Pet Box / Goals accounting authority. Preview only.
   */
  readonly longTermPreview?: {
    readonly petBoxEnabled: boolean
    readonly petBoxName: string
    /** Pet Box balance in pence. Fixture only. */
    readonly petBoxBalancePence: number
    /** Pet Box feeding label, e.g. "Feeding in 7 days". */
    readonly petBoxFeedingLabel?: string
    readonly primaryGoalId?: string
    readonly primaryGoalTitle: string
    /** Goal current saved amount, in pence. */
    readonly primaryGoalCurrentPence: number
    /** Goal target amount, in pence. */
    readonly primaryGoalTargetPence: number
  }
}

const SAMPLE_QUESTS = [
  { id: 'q-1', title: 'Brush teeth morning', pointsReward: 5, onPress: () => {} },
  { id: 'q-2', title: 'Read 15 minutes', pointsReward: 10, onPress: () => {} },
  { id: 'q-3', title: 'Tidy your room', pointsReward: 30, onPress: () => {} },
] as const

/**
 * Shared, fixture-only long-term band values for every preview canvas.
 * These numbers are deliberately NOT sourced from any real account
 * and exist solely so QA can see Pet Box + Goals render in the DEV
 * preview without an authenticated child session. They MUST never
 * reach the canonical store or Firestore.
 *
 *   Pet Box : Nimbus · £57.29
 *   Goals   : Bike fund · £120 of £250
 */
const FIXTURE_LONG_TERM = {
  petBoxEnabled: true,
  petBoxName: 'Nimbus',
  // £57.29 → 5729 pence (deterministic)
  petBoxBalancePence: 5729,
  petBoxFeedingLabel: 'Feeding in 7 days',
  primaryGoalId: 'goal-bike-fund',
  primaryGoalTitle: 'Bike fund',
  // £120 of £250 → 12000 of 25000 pence (deterministic)
  primaryGoalCurrentPence: 12000,
  primaryGoalTargetPence: 25000,
} as const

/**
 * Map a fixture kind to the world it should preview.
 *
 * The preview route reads this map to set the world override so QA
 * can compare worlds with identical content. New fixture kinds MUST
 * either map a world here or set `worldId` directly on the fixture.
 */
export const FIXTURE_KIND_WORLD: Readonly<Record<PreviewFixtureKind, WorldId>> = Object.freeze({
  'normal-quests': 'world.normal',
  'normal-all-caught-up': 'world.normal',
  surge: 'world.normal',
  'mystery-locked': 'world.normal',
  'mystery-ready': 'world.normal',
  'mystery-reveal': 'world.normal',
  'comeback-1d': 'world.normal',
  'comeback-3d': 'world.normal',
  'comeback-7d': 'world.normal',
  'seasonal-christmas': 'world.christmas',
  'seasonal-halloween': 'world.halloween',
  'seasonal-ramadan-eid': 'world.eid',
  'seasonal-neon': 'world.neon',
  'world-christmas-surge': 'world.christmas',
  'world-halloween-mystery': 'world.halloween',
  'world-eid-comeback': 'world.eid',
  'world-normal-surge': 'world.normal',
  'xp-pop-mystery': 'world.normal',
  'xp-pop-comeback': 'world.normal',
  'reduced-motion': 'world.normal',
}) as Record<PreviewFixtureKind, WorldId>;

export const PREVIEW_FIXTURES: readonly PreviewFixture[] = [
  {
    id: 'normal-quests',
    title: 'Normal · quests waiting',
    kind: 'normal-quests',
    mood: 'friendly',
    expression: 'soft_smile',
    messageKey: 'mascot.welcome.morning',
    mascotLine: 'Three quests are waiting for you.',
    adventurePresentation: { kind: 'normal', reason: 'no_special_opportunity' },
    mysteryDrop: null,
    surge: null,
    comeback: null,
    normalQuestCount: 3,
    allCaughtUp: false,
    quests: SAMPLE_QUESTS,
    longTermPreview: FIXTURE_LONG_TERM,
  },
  {
    id: 'normal-all-caught-up',
    title: 'Normal · all caught up',
    kind: 'normal-all-caught-up',
    mood: 'celebrating',
    expression: 'big_smile',
    messageKey: 'mascot.celebrate.complete',
    mascotLine: 'Everything is done for today — amazing work!',
    adventurePresentation: { kind: 'normal', reason: 'no_special_opportunity' },
    mysteryDrop: null,
    surge: null,
    comeback: null,
    normalQuestCount: 0,
    allCaughtUp: true,
    quests: SAMPLE_QUESTS.map(q => ({ ...q, isCompletedToday: true })),
    longTermPreview: FIXTURE_LONG_TERM,
  },
  {
    id: 'surge',
    title: 'Active Surge',
    kind: 'surge',
    mood: 'excited',
    expression: 'sparkle_burst',
    messageKey: 'mascot.celebrate.surge',
    mascotLine: 'Surge is live — get a 2× XP bonus right now!',
    adventurePresentation: { kind: 'surge', reason: 'active_surge' },
    mysteryDrop: null,
    surge: {
      surgeId: 'sg-1',
      eligibleTasks: [{ id: 't-surge', title: 'House Vacuum', pointsReward: 30 }],
      endsAt: Date.now() + 18 * 60_000,
    },
    comeback: null,
    normalQuestCount: 0,
    allCaughtUp: false,
    quests: SAMPLE_QUESTS,
    longTermPreview: FIXTURE_LONG_TERM,
  },
  {
    id: 'mystery-locked',
    title: 'Mystery · locked',
    kind: 'mystery-locked',
    mood: 'curious',
    expression: 'raised_eyebrow',
    messageKey: 'mascot.celebrate.locked',
    mascotLine: 'Something mysterious appeared…',
    adventurePresentation: { kind: 'mystery_available', reason: 'mystery_progressing' },
    mysteryDrop: {
      id: 'd-1',
      rarity: 'common',
      messageKey: 'child.adventure.mystery.lockedLead',
      isRevealReady: false,
      progressLabel: '0 / 1',
    },
    surge: null,
    comeback: null,
    normalQuestCount: 3,
    allCaughtUp: false,
    quests: SAMPLE_QUESTS,
    longTermPreview: FIXTURE_LONG_TERM,
  },
  {
    id: 'mystery-ready',
    title: 'Mystery · ready',
    kind: 'mystery-ready',
    mood: 'excited',
    expression: 'sparkle',
    messageKey: 'mascot.celebrate.ready',
    mascotLine: 'Your Mystery Drop is unlocked — tap to open!',
    adventurePresentation: { kind: 'mystery_ready', reason: 'mystery_unlocked' },
    mysteryDrop: {
      id: 'd-2',
      rarity: 'rare',
      messageKey: 'child.adventure.mystery.readyLead',
      isRevealReady: true,
    },
    surge: null,
    comeback: null,
    normalQuestCount: 3,
    allCaughtUp: false,
    quests: SAMPLE_QUESTS,
    longTermPreview: FIXTURE_LONG_TERM,
  },
  {
    id: 'mystery-reveal',
    title: 'Mystery · reveal',
    kind: 'mystery-reveal',
    mood: 'celebrating',
    expression: 'sparkle_burst',
    messageKey: 'mascot.celebrate.reward',
    mascotLine: 'You got +25 XP and a brand-new look!',
    adventurePresentation: { kind: 'mystery_ready', reason: 'mystery_unlocked' },
    mysteryDrop: {
      id: 'd-3',
      rarity: 'epic',
      messageKey: 'child.adventure.mystery.rewardCollectionTitle',
      isRevealReady: true,
    },
    surge: null,
    comeback: null,
    normalQuestCount: 3,
    allCaughtUp: false,
    quests: SAMPLE_QUESTS,
    longTermPreview: FIXTURE_LONG_TERM,
  },
  {
    id: 'comeback-1d',
    title: 'Comeback · return_1d',
    kind: 'comeback-1d',
    mood: 'welcome_back',
    expression: 'big_smile',
    messageKey: 'mascot.welcome.back',
    mascotLine: 'Hi again!',
    adventurePresentation: { kind: 'comeback', reason: 'comeback_active' },
    mysteryDrop: null,
    surge: null,
    comeback: { tier: 'return_1d', inactivityDays: 1, missionCompleted: false },
    normalQuestCount: 0,
    allCaughtUp: false,
    quests: SAMPLE_QUESTS,
    longTermPreview: FIXTURE_LONG_TERM,
  },
  {
    id: 'comeback-3d',
    title: 'Comeback · return_3d',
    kind: 'comeback-3d',
    mood: 'welcome_back',
    expression: 'big_smile',
    messageKey: 'mascot.welcome.back',
    mascotLine: 'Great to see you again!',
    adventurePresentation: { kind: 'comeback', reason: 'comeback_active' },
    mysteryDrop: null,
    surge: null,
    comeback: { tier: 'return_3d', inactivityDays: 3, missionCompleted: false },
    normalQuestCount: 0,
    allCaughtUp: false,
    quests: SAMPLE_QUESTS,
    longTermPreview: FIXTURE_LONG_TERM,
  },
  {
    id: 'comeback-7d',
    title: 'Comeback · return_7d',
    kind: 'comeback-7d',
    mood: 'welcome_back',
    expression: 'big_smile',
    messageKey: 'mascot.welcome.back',
    mascotLine: 'Great to see you again!',
    adventurePresentation: { kind: 'comeback', reason: 'comeback_active' },
    mysteryDrop: null,
    surge: null,
    comeback: { tier: 'return_7d', inactivityDays: 7, missionCompleted: false },
    normalQuestCount: 0,
    allCaughtUp: false,
    quests: SAMPLE_QUESTS,
    longTermPreview: FIXTURE_LONG_TERM,
  },
  {
    id: 'seasonal-christmas',
    title: 'Seasonal · Christmas',
    kind: 'seasonal-christmas',
    mood: 'celebrating',
    expression: 'big_smile',
    messageKey: 'mascot.seasonal.christmas',
    mascotLine: 'Happy holidays — Queki is wearing a Santa hat!',
    adventurePresentation: { kind: 'seasonal', reason: 'seasonal_only' },
    mysteryDrop: null,
    surge: null,
    comeback: null,
    normalQuestCount: 3,
    allCaughtUp: false,
    quests: SAMPLE_QUESTS,
    longTermPreview: FIXTURE_LONG_TERM,
  },
  {
    id: 'seasonal-halloween',
    title: 'Seasonal · Halloween',
    kind: 'seasonal-halloween',
    mood: 'suspicious',
    expression: 'raised_eyebrow',
    messageKey: 'mascot.seasonal.halloween',
    mascotLine: 'Spooky day — Queki is curious!',
    adventurePresentation: { kind: 'seasonal', reason: 'seasonal_only' },
    mysteryDrop: null,
    surge: null,
    comeback: null,
    normalQuestCount: 3,
    allCaughtUp: false,
    quests: SAMPLE_QUESTS,
    longTermPreview: FIXTURE_LONG_TERM,
  },
  {
    id: 'seasonal-ramadan-eid',
    title: 'Seasonal · Ramadan / Eid',
    kind: 'seasonal-ramadan-eid',
    mood: 'friendly',
    expression: 'soft_smile',
    messageKey: 'mascot.seasonal.ramadan',
    mascotLine: 'A festive season — welcome back to today.',
    adventurePresentation: { kind: 'seasonal', reason: 'seasonal_only' },
    mysteryDrop: null,
    surge: null,
    comeback: null,
    normalQuestCount: 3,
    allCaughtUp: false,
    quests: SAMPLE_QUESTS,
    longTermPreview: FIXTURE_LONG_TERM,
  },
  {
    id: 'seasonal-neon',
    title: 'Seasonal · Neon weekly',
    kind: 'seasonal-neon',
    mood: 'excited',
    expression: 'sparkle_burst',
    messageKey: 'mascot.weekly.neon',
    mascotLine: 'Neon City week — quests pop with energy!',
    adventurePresentation: { kind: 'normal', reason: 'no_special_opportunity' },
    mysteryDrop: null,
    surge: null,
    comeback: null,
    normalQuestCount: 3,
    allCaughtUp: false,
    quests: SAMPLE_QUESTS,
    longTermPreview: FIXTURE_LONG_TERM,
  },
  {
    id: 'xp-pop-mystery',
    title: 'XP pop · Mystery',
    kind: 'xp-pop-mystery',
    mood: 'excited',
    expression: 'sparkle',
    messageKey: 'mascot.xp.mystery',
    mascotLine: '+20 XP from Mystery!',
    adventurePresentation: { kind: 'normal', reason: 'no_special_opportunity' },
    mysteryDrop: null,
    surge: null,
    comeback: null,
    normalQuestCount: 3,
    allCaughtUp: false,
    quests: SAMPLE_QUESTS,
    longTermPreview: FIXTURE_LONG_TERM,
  },
  {
    id: 'xp-pop-comeback',
    title: 'XP pop · Comeback',
    kind: 'xp-pop-comeback',
    mood: 'celebrating',
    expression: 'big_smile',
    messageKey: 'mascot.xp.comeback',
    mascotLine: '+25 XP comeback bonus!',
    adventurePresentation: { kind: 'comeback', reason: 'comeback_active' },
    mysteryDrop: null,
    surge: null,
    comeback: { tier: 'return_3d', inactivityDays: 3, missionCompleted: true },
    normalQuestCount: 0,
    allCaughtUp: false,
    quests: SAMPLE_QUESTS,
    longTermPreview: FIXTURE_LONG_TERM,
  },
  {
    id: 'world-normal-surge',
    title: 'World · Normal + Surge',
    kind: 'world-normal-surge',
    worldId: 'world.normal',
    mood: 'excited',
    expression: 'sparkle_burst',
    messageKey: 'mascot.celebrate.surge',
    mascotLine: 'Surge is live — get a 2× XP bonus right now!',
    adventurePresentation: { kind: 'surge', reason: 'active_surge' },
    mysteryDrop: null,
    surge: {
      surgeId: 'sg-1',
      eligibleTasks: [{ id: 't-surge', title: 'House Vacuum', pointsReward: 30 }],
      endsAt: Date.now() + 18 * 60_000,
    },
    comeback: null,
    normalQuestCount: 0,
    allCaughtUp: false,
    quests: SAMPLE_QUESTS,
    longTermPreview: FIXTURE_LONG_TERM,
  },
  {
    id: 'world-christmas-surge',
    title: 'World · Christmas + Surge',
    kind: 'world-christmas-surge',
    worldId: 'world.christmas',
    mood: 'excited',
    expression: 'sparkle_burst',
    messageKey: 'mascot.celebrate.surge',
    mascotLine: 'Cosy Christmas + a Surge — snow is on its way!',
    adventurePresentation: { kind: 'surge', reason: 'active_surge' },
    mysteryDrop: null,
    surge: {
      surgeId: 'sg-x',
      eligibleTasks: [{ id: 't-xmas', title: 'Wrap the presents', pointsReward: 25 }],
      endsAt: Date.now() + 18 * 60_000,
    },
    comeback: null,
    normalQuestCount: 0,
    allCaughtUp: false,
    quests: SAMPLE_QUESTS,
    longTermPreview: FIXTURE_LONG_TERM,
  },
  {
    id: 'world-halloween-mystery',
    title: 'World · Halloween + Mystery Ready',
    kind: 'world-halloween-mystery',
    worldId: 'world.halloween',
    mood: 'curious',
    expression: 'raised_eyebrow',
    messageKey: 'mascot.celebrate.ready',
    mascotLine: 'A friendly mystery is waiting under the moon!',
    adventurePresentation: { kind: 'mystery_ready', reason: 'mystery_unlocked' },
    mysteryDrop: {
      id: 'd-hw',
      rarity: 'epic',
      messageKey: 'child.adventure.mystery.readyLead',
      isRevealReady: true,
    },
    surge: null,
    comeback: null,
    normalQuestCount: 3,
    allCaughtUp: false,
    quests: SAMPLE_QUESTS,
    longTermPreview: FIXTURE_LONG_TERM,
  },
  {
    id: 'world-eid-comeback',
    title: 'World · Eid + Comeback',
    kind: 'world-eid-comeback',
    worldId: 'world.eid',
    mood: 'welcome_back',
    expression: 'big_smile',
    messageKey: 'mascot.welcome.back',
    mascotLine: 'Eid Mubarak — welcome back to today\'s quests.',
    adventurePresentation: { kind: 'comeback', reason: 'comeback_active' },
    mysteryDrop: null,
    surge: null,
    comeback: { tier: 'return_3d', inactivityDays: 3, missionCompleted: false },
    normalQuestCount: 0,
    allCaughtUp: false,
    quests: SAMPLE_QUESTS,
    longTermPreview: FIXTURE_LONG_TERM,
  },
  {
    id: 'reduced-motion',
    title: 'Reduced motion',
    kind: 'reduced-motion',
    mood: 'friendly',
    expression: 'soft_smile',
    messageKey: 'mascot.welcome.calm',
    mascotLine: 'Reduced motion is on — animations collapse to instant.',
    adventurePresentation: { kind: 'mystery_ready', reason: 'mystery_unlocked' },
    mysteryDrop: {
      id: 'd-rm',
      rarity: 'rare',
      messageKey: 'child.adventure.mystery.readyLead',
      isRevealReady: true,
    },
    surge: null,
    comeback: null,
    normalQuestCount: 3,
    allCaughtUp: false,
    quests: SAMPLE_QUESTS,
    longTermPreview: FIXTURE_LONG_TERM,
  },
]

export function findFixtureById(id: string | null): PreviewFixture | null {
  if (id === null) return null
  return PREVIEW_FIXTURES.find(f => f.id === id) ?? null
}
