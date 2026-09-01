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
 */

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
  | 'xp-pop-mystery'
  | 'xp-pop-comeback'
  | 'reduced-motion'

export interface PreviewFixture {
  readonly id: string
  readonly title: string
  readonly kind: PreviewFixtureKind
}

export const PREVIEW_FIXTURES: readonly PreviewFixture[] = [
  { id: 'normal-quests',         title: 'Normal · quests waiting',   kind: 'normal-quests' },
  { id: 'normal-all-caught-up',  title: 'Normal · all caught up',    kind: 'normal-all-caught-up' },
  { id: 'surge',                 title: 'Active Surge',              kind: 'surge' },
  { id: 'mystery-locked',        title: 'Mystery · locked',          kind: 'mystery-locked' },
  { id: 'mystery-ready',         title: 'Mystery · ready',           kind: 'mystery-ready' },
  { id: 'mystery-reveal',        title: 'Mystery · reveal',          kind: 'mystery-reveal' },
  { id: 'comeback-1d',           title: 'Comeback · return_1d',      kind: 'comeback-1d' },
  { id: 'comeback-3d',           title: 'Comeback · return_3d',      kind: 'comeback-3d' },
  { id: 'comeback-7d',           title: 'Comeback · return_7d',      kind: 'comeback-7d' },
  { id: 'seasonal-christmas',    title: 'Seasonal · Christmas',      kind: 'seasonal-christmas' },
  { id: 'seasonal-halloween',    title: 'Seasonal · Halloween',      kind: 'seasonal-halloween' },
  { id: 'seasonal-ramadan-eid',  title: 'Seasonal · Ramadan / Eid',      kind: 'seasonal-ramadan-eid' },
  { id: 'seasonal-neon',         title: 'Seasonal · Neon weekly',    kind: 'seasonal-neon' },
  { id: 'xp-pop-mystery',        title: 'XP pop · Mystery',          kind: 'xp-pop-mystery' },
  { id: 'xp-pop-comeback',       title: 'XP pop · Comeback',         kind: 'xp-pop-comeback' },
  { id: 'reduced-motion',        title: 'Reduced motion',            kind: 'reduced-motion' },
]

export function findFixtureById(id: string | null): PreviewFixture | null {
  if (id === null) return null
  return PREVIEW_FIXTURES.find(f => f.id === id) ?? null
}