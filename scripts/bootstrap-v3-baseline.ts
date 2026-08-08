/**
 * LEGACY_BASELINE bootstrap script.
 *
 * Creates a LEGACY_BASELINE V3 event for every existing member, capturing
 * their current legacy state as the V3 opening position.
 *
 * Amendment 5 — baseline state completeness:
 * The LEGACY_BASELINE event represents the complete V3 opening state:
 * - rewardPoints: current legacy rewardPoints balance
 * - xpTotal: current legacy xpTotal (from gamification_summaries)
 * - currentStreak, bestStreak, lastQualifiedDayKey: from summary
 * - unlockedAvatarIds: from avatar_unlocks collection
 * - weeklyPoints: 0 (baseline does not inflate current week)
 * - weeklyWindowKey: derived from bootstrap context
 *
 * Dry-run mode: --dry-run flag to read and report without writing.
 */
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { initializeApp, cert } from 'firebase-admin/app'
import { AdminV3EventRepository } from '../functions/src/gamificationV3/eventRepository'
import { AdminV3ProjectionRepository } from '../functions/src/gamificationV3/projectionRepository'
import { writeShadowEvent } from '../functions/src/gamificationV3/shadowWriter'
import { GAMIFICATION_V3_SCHEMA_VERSION, type LegacyBaselineEventV3 } from '../src/domain/gamification/v3/event'
import { legacyBaselineEventId } from '../src/domain/gamification/v3/ids'
import { DEFAULT_WEEKLY_CONTEXT, resolveWeeklyContext } from '../src/domain/gamification/v3/weeklyWindow'

export interface BaselineInput {
  readonly familyId: string
  readonly memberId: string
  readonly rewardPoints: number
  readonly xpTotal: number
  readonly currentStreak: number
  readonly bestStreak: number
  readonly lastQualifiedDayKey: string | null
  readonly unlockedAvatarIds: readonly string[]
  readonly dryRun: boolean
}

export interface BaselineResult {
  readonly memberId: string
  readonly status: 'created' | 'already_exists' | 'dry_run' | 'failed'
  readonly eventId: string
  readonly rewardPoints: number
  readonly xpTotal: number
}

const ARGS = process.argv.slice(2)
const IS_DRY_RUN = ARGS.includes('--dry-run')

async function main() {
  if (process.env.FCM_SERVICE_ACCOUNT_PATH) {
    initializeApp({ credential: cert(process.env.FCM_SERVICE_ACCOUNT_PATH) })
  } else {
    initializeApp()
  }
  const db = getFirestore()

  const eventRepo = new AdminV3EventRepository(db)
  const projectionRepo = new AdminV3ProjectionRepository(db)

  const families = await db.collection('familities').get()
  const results: BaselineResult[] = []

  for (const familyDoc of families.docs) {
    const familyId = familyDoc.id
    const members = await db.collection('users')
      .where('familyId', '==', familyId)
      .where('role', 'in', ['child'])
      .get()

    for (const memberDoc of members.docs) {
      const memberId = memberDoc.id
      const data = memberDoc.data()

      const summaryDoc = await db.doc(`families/${familyId}/gamification_summaries/${memberId}`).get()
      const summary = summaryDoc.data()

      // Read unlocked avatars
      const unlocks = await db.collection(`families/${familyId}/avatar_unlocks`)
        .where('childId', '==', memberId)
        .get()
      const unlockedAvatarIds = unlocks.docs.map(d => (d.data().avatarId as string)).filter(Boolean)

      const input: BaselineInput = {
        familyId,
        memberId,
        rewardPoints: typeof data.rewardPoints === 'number' ? data.rewardPoints : 0,
        xpTotal: typeof summary?.xpTotal === 'number' ? summary.xpTotal : 0,
        currentStreak: typeof summary?.currentStreak === 'number' ? summary.currentStreak : 0,
        bestStreak: typeof summary?.bestStreak === 'number' ? summary.bestStreak : 0,
        lastQualifiedDayKey: typeof summary?.lastQualifiedDayKey === 'string' ? summary.lastQualifiedDayKey : null,
        unlockedAvatarIds,
        dryRun: IS_DRY_RUN,
      }

      const result = await bootstrapMemberBaseline(eventRepo, projectionRepo, input)
      results.push(result)
    }
  }

  // Report
  const created = results.filter(r => r.status === 'created').length
  const existing = results.filter(r => r.status === 'already_exists').length
  const dryRun = results.filter(r => r.status === 'dry_run').length
  const failed = results.filter(r => r.status === 'failed').length

  console.log(JSON.stringify({ total: results.length, created, already_exists: existing, dry_run: dryRun, failed, results }, null, 2))
}

export async function bootstrapMemberBaseline(
  eventRepo: AdminV3EventRepository,
  projectionRepo: AdminV3ProjectionRepository,
  input: BaselineInput,
): Promise<BaselineResult> {
  const eventId = legacyBaselineEventId(input.familyId, input.memberId)

  // Check if already exists
  const existing = await eventRepo.readEvent(input.familyId, eventId)
  if (existing !== null) {
    return {
      memberId: input.memberId,
      status: 'already_exists',
      eventId,
      rewardPoints: input.rewardPoints,
      xpTotal: input.xpTotal,
    }
  }

  if (input.dryRun) {
    return {
      memberId: input.memberId,
      status: 'dry_run',
      eventId,
      rewardPoints: input.rewardPoints,
      xpTotal: input.xpTotal,
    }
  }

  try {
    const baselineEvent: LegacyBaselineEventV3 = {
      schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
      eventId,
      eventType: 'LEGACY_BASELINE',
      familyId: input.familyId,
      memberId: input.memberId,
      sourceType: 'bootstrap',
      sourceId: 'baseline',
      effectiveAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      rewardPointsDelta: input.rewardPoints,
      xpDelta: input.xpTotal,
      weeklyPointsDelta: 0,
      idempotencyKey: eventId,
      metadata: {
        currentStreak: input.currentStreak,
        bestStreak: input.bestStreak,
        lastQualifiedDayKey: input.lastQualifiedDayKey,
        unlockedAvatarIds: [...input.unlockedAvatarIds],
      },
    }

    await writeShadowEvent(
      {
        eventRepo,
        projectionRepo,
        now: () => new Date().toISOString(),
        weeklyContext: DEFAULT_WEEKLY_CONTEXT,
      },
      baselineEvent,
    )

    return {
      memberId: input.memberId,
      status: 'created',
      eventId,
      rewardPoints: input.rewardPoints,
      xpTotal: input.xpTotal,
    }
  } catch (error) {
    return {
      memberId: input.memberId,
      status: 'failed',
      eventId,
      rewardPoints: input.rewardPoints,
      xpTotal: input.xpTotal,
    }
  }
}

if (require.main === module) {
  main().catch(console.error)
}