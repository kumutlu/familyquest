/**
 * Comeback Missions V1 — pure type contracts.
 *
 * Engagement creates opportunities; gamification awards value.
 *
 * These types are the single source of truth for the Comeback model.
 * They are imported by the client-side engagement resolver (for
 * presentation / Mascot / Notification candidates) and by the
 * server-side authoritative evaluator (for awarding). They MUST NOT
 * import from Firestore, React, or any side-effecting module.
 *
 * Boundary semantics (pinned by tests):
 *   inactivityDays is computed in FAMILY-LOCAL calendar days
 *   (using a supplied timezone). Whole-day boundaries.
 *
 * Tier mapping (pinned by tests):
 *   inactivityDays  < 1                 → none
 *   1  ≤ inactivityDays < 3            → return_1d
 *   3  ≤ inactivityDays < 7            → return_3d
 *   7  ≤ inactivityDays                 → return_7d
 */

export type ComebackTier = 'none' | 'return_1d' | 'return_3d' | 'return_7d'

export interface ComebackState {
  readonly tier: ComebackTier
  readonly inactivityDays: number
  /** The mission id awarded when the child completes any quest today.
   *  `null` when tier is `none` or when the mission has already been
   *  completed for the active local date. */
  readonly missionId: string | null
  /** Whether today's qualifying mission has already been completed
   *  for this child. */
  readonly missionCompleted: boolean
}

/** All fields the resolver needs. */
export interface ResolveComebackInput {
  /** Family IANA timezone. Used for family-local calendar-day math. */
  readonly timezone: string
  /** Current epoch ms. */
  readonly now: number
  /** Last meaningful activity for the child (e.g. last approved task
   *  completion timestamp). When `undefined` or `null`, the resolver
   *  treats the child as `return_7d`. */
  readonly lastMeaningfulActivityAt?: number | null
  /** Already-completed comeback tiers for this child for the local
   *  date (server-derived). When the active tier is in this set, the
   *  resolver reports `missionCompleted: true` and `missionId: null`. */
  readonly completedTiersForDate?: readonly ComebackTier[]
}

/** Result of a Comeback resolver call. */
export interface ResolveComebackResult {
  readonly tier: ComebackTier
  readonly inactivityDays: number
  readonly missionId: string | null
  readonly missionCompleted: boolean
}

/* -------------------------------------------------------------------------- */
/* Idempotency                                                                */
/* -------------------------------------------------------------------------- */

export function comebackEventId(childId: string, localDate: string, tier: ComebackTier): string {
  assertSegment(childId, 'childId')
  assertDate(localDate, 'localDate')
  return `comeback:${childId}:${localDate}:${tier}`
}

export function comebackReversalEventId(childId: string, localDate: string, tier: ComebackTier): string {
  return `${comebackEventId(childId, localDate, tier)}:reversal`
}

export function comebackEvidenceId(childId: string, localDate: string, tier: ComebackTier): string {
  assertSegment(childId, 'childId')
  assertDate(localDate, 'localDate')
  return `${childId}__${localDate}__${tier}`
}

/* -------------------------------------------------------------------------- */
/* Reward table (V1)                                                          */
/* -------------------------------------------------------------------------- */

export interface ComebackRewardTable {
  readonly return_1d: number
  readonly return_3d: number
  readonly return_7d: number
}

/**
 * Default XP rewards (pinned by tests). Fixed values, NOT multipliers.
 * The reward authority adds these via the `COMEBACK_MISSION_XP_AWARDED`
 * event type.
 */
export const DEFAULT_COMEBACK_REWARD_TABLE: Readonly<ComebackRewardTable> = Object.freeze({
  return_1d: 0,
  return_3d: 25,
  return_7d: 50,
}) as ComebackRewardTable

/* -------------------------------------------------------------------------- */
/* Tier-to-mission map                                                        */
/* -------------------------------------------------------------------------- */

export interface ComebackMissionDefinition {
  readonly tier: ComebackTier
  readonly titleKey: string
  readonly descriptionKey: string
  readonly rewardXp: number
}

export const COMEBACK_MISSION_BY_TIER: ReadonlyMap<ComebackTier, ComebackMissionDefinition> = new Map<ComebackTier, ComebackMissionDefinition>([
  ['return_1d', { tier: 'return_1d', titleKey: 'comeback.mission.return_1d.title', descriptionKey: 'comeback.mission.return_1d.description', rewardXp: 0 }],
  ['return_3d', { tier: 'return_3d', titleKey: 'comeback.mission.return_3d.title', descriptionKey: 'comeback.mission.return_3d.description', rewardXp: 25 }],
  ['return_7d', { tier: 'return_7d', titleKey: 'comeback.mission.return_7d.title', descriptionKey: 'comeback.mission.return_7d.description', rewardXp: 50 }],
])

/* -------------------------------------------------------------------------- */
/* Family-local calendar-day arithmetic                                        */
/* -------------------------------------------------------------------------- */

/**
 * Translate epoch ms to a `YYYY-MM-DD` family-local date key.
 * Falls back to UTC for invalid timezones.
 */
export function localDateKey(now: number, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timezone,
    }).formatToParts(new Date(now))
    const y = parts.find(p => p.type === 'year')?.value ?? '1970'
    const m = parts.find(p => p.type === 'month')?.value ?? '01'
    const d = parts.find(p => p.type === 'day')?.value ?? '01'
    return `${y}-${m}-${d}`
  } catch {
    const date = new Date(now)
    const y = date.getUTCFullYear()
    const m = `${date.getUTCMonth() + 1}`.padStart(2, '0')
    const d = `${date.getUTCDate()}`.padStart(2, '0')
    return `${y}-${m}-${d}`
  }
}

/** Alias to make the family-local-day math self-documenting. */
export function familyLocalDateKey(now: number, timezone: string): string {
  return localDateKey(now, timezone)
}

/**
 * Compute whole calendar-day difference between two family-local date
 * keys. Negative result when `earlier > later` (treated as 0).
 */
export function inactivityDaysBetween(laterLocalDate: string, earlierLocalDate: string): number {
  assertDate(laterLocalDate, 'laterLocalDate')
  assertDate(earlierLocalDate, 'earlierLocalDate')
  const later = parseDateKey(laterLocalDate)
  const earlier = parseDateKey(earlierLocalDate)
  const diffMs = utcMidnight(later) - utcMidnight(earlier)
  if (!Number.isFinite(diffMs)) return 0
  return Math.max(0, Math.floor(diffMs / 86_400_000))
}

function utcMidnight(parts: readonly [number, number, number]): number {
  return Date.UTC(parts[0], parts[1] - 1, parts[2])
}

function parseDateKey(key: string): readonly [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (m === null) throw new Error(`invalid local date key: ${key}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function assertSegment(value: string, label: string): void {
  if (value.length === 0 || value.includes('/')) {
    throw new Error(`${label} must be a non-empty Firestore segment`)
  }
}

function assertDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must use the YYYY-MM-DD format`)
  }
}

/** Resolve the tier into a reward from the (possibly overridden) table. */
export function comebackXpReward(tier: ComebackTier, table: Readonly<ComebackRewardTable> = DEFAULT_COMEBACK_REWARD_TABLE): number {
  switch (tier) {
    case 'return_1d': return table.return_1d
    case 'return_3d': return table.return_3d
    case 'return_7d': return table.return_7d
    case 'none': return 0
  }
}