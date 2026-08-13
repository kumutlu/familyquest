import type { GamificationEventV1 } from './types'

export interface RawXpDocument {
  readonly id: string
  readonly data: Readonly<Record<string, unknown>>
}

export interface NormalizedXpDocument {
  readonly id: string
  readonly event: GamificationEventV1
  readonly normalization: 'canonical' | 'legacy'
}

export class UnknownXpEventError extends Error {
  constructor(readonly documentId: string, reason: string) {
    super(`Unknown XP event ${documentId}: ${reason}`)
    this.name = 'UnknownXpEventError'
  }
}

const CANONICAL_EVENT_TYPES = new Set([
  'xp_awarded', 'xp_revoked', 'daily_goal_awarded', 'daily_goal_revoked',
  'daily_goal_qualification_changed', 'perfect_day_awarded', 'perfect_day_revoked',
  'perfect_day_qualification_changed', 'legacy_xp_baseline',
])

function timestamp(value: unknown, documentId: string, field: string): number {
  if (value instanceof Date && Number.isSafeInteger(value.getTime()) && value.getTime() >= 0) return value.getTime()
  if (value !== null && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    const millis = (value as { toMillis(): number }).toMillis()
    if (Number.isSafeInteger(millis) && millis >= 0) return millis
  }
  throw new UnknownXpEventError(documentId, `${field} is not a timestamp`)
}

function string(value: unknown, documentId: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new UnknownXpEventError(documentId, `${field} is missing`)
  return value
}

function xp(value: unknown, documentId: string): number {
  if (!Number.isSafeInteger(value)) throw new UnknownXpEventError(documentId, 'xpDelta is not a safe integer')
  return value as number
}

function canonical(document: RawXpDocument): NormalizedXpDocument {
  const { id, data } = document
  const eventType = string(data.eventType, id, 'eventType')
  if (!CANONICAL_EVENT_TYPES.has(eventType)) throw new UnknownXpEventError(id, 'unsupported XP-bearing event shape')
  if (data.schemaVersion !== 1) throw new UnknownXpEventError(id, 'unsupported schemaVersion')
  const effectiveAt = timestamp(data.effectiveAt, id, 'effectiveAt')
  const createdAt = timestamp(data.createdAt, id, 'createdAt')
  const transitionRank = data.transitionRank
  if (!Number.isInteger(transitionRank)) throw new UnknownXpEventError(id, 'transitionRank is missing')
  return {
    id,
    normalization: 'canonical',
    event: {
      ...data,
      eventType,
      familyId: string(data.familyId, id, 'familyId'),
      childId: string(data.childId, id, 'childId'),
      xpDelta: xp(data.xpDelta, id),
      sourceType: string(data.sourceType, id, 'sourceType'),
      sourceId: string(data.sourceId, id, 'sourceId'),
      idempotencyKey: string(data.idempotencyKey, id, 'idempotencyKey'),
      causalGroupId: string(data.causalGroupId, id, 'causalGroupId'),
      transitionRank,
      effectiveAt,
      createdAt,
    } as GamificationEventV1,
  }
}

function knownBehaviour(document: RawXpDocument, familyId: string): NormalizedXpDocument {
  const { id, data } = document
  const effectiveAt = timestamp(data.effectiveAt, id, 'effectiveAt')
  const idempotencyKey = string(data.idempotencyKey, id, 'idempotencyKey')
  return {
    id,
    normalization: 'canonical',
    event: {
      ...data,
      schemaVersion: 1,
      familyId,
      childId: string(data.childId, id, 'childId'),
      eventType: 'behaviour_positive',
      xpDelta: xp(data.xpDelta, id),
      sourceType: 'behaviour_event',
      sourceId: string(data.sourceId, id, 'sourceId'),
      idempotencyKey,
      causalGroupId: idempotencyKey,
      transitionRank: 0,
      effectiveAt,
      createdAt: timestamp(data.createdAt, id, 'createdAt'),
      configSchemaVersion: 1,
      createdBy: 'behaviour-processor-v1',
    },
  }
}

function knownLegacy(document: RawXpDocument, familyId: string): NormalizedXpDocument | undefined {
  const { id, data } = document
  const isBehaviourBackfill = /^behaviour_xp_backfill:[^/]+$/.test(id) && data.eventType === 'xp_backfill'
  const isTaskCompletion = /^task_xp:task_v1\|[^|]+\|[^|]+\|\d{4}-\d{2}-\d{2}$/.test(id) && data.eventType === 'task_completion'
  if (!isBehaviourBackfill && !isTaskCompletion) return undefined
  const effectiveAt = timestamp(data.effectiveAt, id, 'effectiveAt')
  return {
    id,
    normalization: 'legacy',
    event: {
      schemaVersion: 1,
      familyId,
      childId: string(data.childId, id, 'childId'),
      eventType: 'xp_awarded',
      xpDelta: xp(data.xpDelta, id),
      sourceType: isBehaviourBackfill ? 'behaviour_event' : 'task_completion',
      sourceId: string(data.sourceId, id, 'sourceId'),
      idempotencyKey: id,
      causalGroupId: id,
      transitionRank: 0,
      effectiveAt,
      createdAt: timestamp(data.createdAt, id, 'createdAt'),
      configSchemaVersion: 1,
      createdBy: 'legacy-xp-normalizer-v1',
    },
  }
}

export function normalizeXpLedger(input: {
  readonly familyId: string
  readonly documents: readonly RawXpDocument[]
}): readonly NormalizedXpDocument[] {
  return input.documents.map(document => {
    const value = document.data
    xp(value.xpDelta, document.id)
    if (value.eventType === 'behaviour_positive' && value.schemaVersion === 1) return knownBehaviour(document, input.familyId)
    const legacy = knownLegacy(document, input.familyId)
    if (legacy !== undefined) return legacy
    return canonical(document)
  })
}
