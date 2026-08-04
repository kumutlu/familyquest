import { type GamificationEventV3 } from '../../../src/domain/gamification/v3/event'
import { type GamificationStateV3 } from '../../../src/domain/gamification/v3/state'
import { type ReducerContextV3 } from '../../../src/domain/gamification/v3/reducer'
import { type V3EventRepository } from './eventRepository'
import { type V3ProjectionRepository } from './projectionRepository'

export interface RebuildResult {
  readonly memberId: string
  readonly eventsRead: number
  readonly state: GamificationStateV3
  readonly matchesStored: boolean
}

export interface RebuildDependencies {
  readonly eventRepo: V3EventRepository
  readonly projectionRepo: V3ProjectionRepository
}

/**
 * Rebuild a member's projection from the full event ledger.
 *
 * 1. Reads all events for the member.
 * 2. Deletes the stored projection.
 * 3. Rebuilds the projection via the pure reducer.
 * 4. Writes the rebuilt projection.
 * 5. Reports whether the rebuilt state matches the previously stored state.
 *
 * Safe to rerun: idempotent, deterministic, no side effects on legacy data.
 */
export async function rebuildMemberProjection(
  deps: RebuildDependencies,
  familyId: string,
  memberId: string,
  context: ReducerContextV3,
): Promise<RebuildResult> {
  // Read the stored projection before deletion (for comparison)
  const stored = await deps.projectionRepo.readProjection(familyId, memberId)

  // Read all events for the member
  const events = await deps.eventRepo.readMemberEvents(familyId, memberId)

  // Rebuild the projection
  const rebuilt = deps.projectionRepo.rebuildProjection(familyId, memberId, events, context)

  // Delete the old projection and write the rebuilt one
  await deps.projectionRepo.deleteProjection(familyId, memberId)
  await deps.projectionRepo.writeProjection(familyId, rebuilt)

  // Compare business fields (exclude metadata)
  const matchesStored = stored !== null && businessFieldsEqual(stored, rebuilt)

  return {
    memberId,
    eventsRead: events.length,
    state: rebuilt,
    matchesStored,
  }
}

/** Business fields used for rebuild equality comparison. */
const BUSINESS_FIELDS: readonly (keyof GamificationStateV3)[] = [
  'rewardPoints',
  'xpTotal',
  'weeklyPoints',
  'weeklyWindowKey',
  'level',
  'xpProgressInLevel',
  'xpToNextLevel',
  'levelProgressPercentage',
  'currentStreak',
  'bestStreak',
  'lastQualifiedDayKey',
  'unlockedAvatarIds',
]

function businessFieldsEqual(a: GamificationStateV3, b: GamificationStateV3): boolean {
  for (const field of BUSINESS_FIELDS) {
    const va = a[field]
    const vb = b[field]
    if (Array.isArray(va) && Array.isArray(vb)) {
      if (va.length !== vb.length || va.some((v, i) => v !== vb[i])) return false
    } else if (va !== vb) {
      return false
    }
  }
  return true
}