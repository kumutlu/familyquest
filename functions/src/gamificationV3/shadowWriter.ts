import { type GamificationEventV3 } from '../../../src/domain/gamification/v3/event'
import { type WeeklyContextV3 } from '../../../src/domain/gamification/v3/weeklyWindow'
import { type V3EventRepository } from './eventRepository'
import { type V3ProjectionRepository } from './projectionRepository'

export interface ShadowWriterDependencies {
  readonly eventRepo: V3EventRepository
  readonly projectionRepo: V3ProjectionRepository
  readonly now: () => string  // ISO-8601 UTC instant
  readonly weeklyContext: WeeklyContextV3
}

export interface ShadowWriteResult {
  readonly status: 'written' | 'duplicate' | 'failed'
  readonly eventId: string
  readonly error?: string
}

/**
 * Write one V3 shadow event and update the member's projection.
 *
 * Algorithm:
 * 1. Check if the event already exists (deterministic eventId → idempotent).
 * 2. Read all existing events for the member.
 * 3. Rebuild the projection from the full ledger plus the new event.
 * 4. Write the event document and the projection document.
 *
 * TEMPORARY BRIDGE (amendment 1): This is the Phase 2 shadow writer.
 * The post-commit trigger approach for reward redemption, avatar unlock,
 * manual adjustment, and reversal is a temporary bridge. Phase 3 must
 * move these flows to server-authoritative callable/transaction paths.
 */
export async function writeShadowEvent(
  deps: ShadowWriterDependencies,
  event: GamificationEventV3,
): Promise<ShadowWriteResult> {
  try {
    // 1. Idempotency check: has this event already been written?
    const existing = await deps.eventRepo.readEvent(event.familyId, event.eventId)
    if (existing !== null) {
      return { status: 'duplicate', eventId: event.eventId }
    }

    // 2. Read all existing events for this member
    const existingEvents = await deps.eventRepo.readMemberEvents(event.familyId, event.memberId)

    // 3. Build the full ledger (existing + new event)
    const allEvents = [...existingEvents, event]

    // 4. Rebuild projection from the full ledger
    const { reduceGamificationEventsV3 } = await import('../../../src/domain/gamification/v3/reducer')
    const newState = deps.projectionRepo.rebuildProjection(
      event.familyId,
      event.memberId,
      allEvents,
      {
        weekly: deps.weeklyContext,
        asOf: deps.now(),
        familyId: event.familyId,
        memberId: event.memberId,
      },
    )

    // 5. Write event + projection
    await deps.eventRepo.writeEvent(event.familyId, event)
    await deps.projectionRepo.writeProjection(event.familyId, newState)

    return { status: 'written', eventId: event.eventId }
  } catch (error) {
    return {
      status: 'failed',
      eventId: event.eventId,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}