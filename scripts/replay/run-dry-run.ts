/**
 * Gamification V4 — Task 2.4 replay CLI dry-run (read-only, no writes).
 * Orchestrates Task 2.1 readers, Task 2.2 classifier, Task 2.3 report emitter,
 * then builds deterministic V4 events and reduces them via the Stage 1 reducer
 * to produce a deterministic replay analysis. Dry-run ONLY: no Firestore
 * writes, no V4 event/state collection creation, no wallet access, no mutation.
 * Reuses (never duplicates) reducer/rebuild/ordering/validators/level/streak/
 * achievement logic. Deterministic; never guesses. No Firestore SDK imported.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  GAMIFICATION_V4_SCHEMA_VERSION,
  SOURCE_TYPE,
  type GamificationEventTypeV4,
} from '../../src/domain/gamification/v4/types'
import type { GamificationEventV4, GamificationStateV4 } from '../../src/domain/gamification/v4/event'
import { eventIdFor } from '../../src/domain/gamification/v4/ids'
import { reduceGamificationEventsV4, type ReduceContextV4 } from '../../src/domain/gamification/v4/reducer'
import { rebuildAllMembers } from '../../src/domain/gamification/v4/rebuild'
import {
  type LegacyFamily,
  type ReplaySourceRecord,
  readTaskCompletions,
  readBehaviours,
  readDailyPerfectDay,
  readRedemptions,
  readRefundsReversals,
  readAvatarUnlocks,
  readManualAdjustments,
} from '../../src/domain/gamification/v4/replay/sources'
import { classifyAll, type ClassifyOptions, type ClassificationResultV4 } from '../../src/domain/gamification/v4/replay/classify'
import { buildReportRows, emitReport, type ReplayReport, type ReplayReportRow } from '../../src/domain/gamification/v4/replay/report'

const DRY_RUN_UPDATED_AT = '1970-01-01T00:00:00.000Z'

export interface ReplayDryRunContext {
  readonly familyId: string
  readonly updatedAt: string
  readonly projectionVersion: number
  readonly taskPointsLookup?: (taskId: string) => number | null
  readonly skipIf?: (source: ReplaySourceRecord) => boolean
  readonly timezone?: string
}

export interface ReplayDryRunResult extends ReplayReport {
  readonly replayedMembers: Readonly<Record<string, GamificationStateV4>>
  readonly eventsBuilt: number
  /** The deterministic V4 events actually folded into replay state (exact + estimated only). */
  readonly events: readonly GamificationEventV4[]
}

function memberIdFor(source: ReplaySourceRecord): string {
  const raw = source.raw as { childId?: string } | null
  return raw?.childId ?? ''
}

function eventTypeForSource(source: ReplaySourceRecord): GamificationEventTypeV4 {
  switch (source.sourceType) {
    case SOURCE_TYPE.TASK_COMPLETION:
      return 'TASK_APPROVED'
    case SOURCE_TYPE.BEHAVIOUR: {
      const raw = source.raw as { behaviourType?: string } | null
      const bt = raw?.behaviourType
      if (bt === 'negative' || bt === 'financial') return 'BEHAVIOUR_NEGATIVE'
      return 'BEHAVIOUR_POSITIVE'
    }
    case SOURCE_TYPE.REWARD_REDEMPTION:
      return 'REWARD_REDEEMED'
    case SOURCE_TYPE.REVERSAL: {
      const raw = source.raw as { kind?: string } | null
      return raw?.kind === 'REFUND' ? 'REWARD_REFUNDED' : 'TASK_REVERSED'
    }
    case SOURCE_TYPE.DAILY_GOAL:
      return 'DAILY_GOAL_AWARDED'
    case SOURCE_TYPE.PERFECT_DAY:
      return 'PERFECT_DAY_AWARDED'
    case SOURCE_TYPE.AVATAR:
      return 'AVATAR_UNLOCKED'
    case SOURCE_TYPE.MANUAL:
    default:
      return 'MANUAL_ADJUSTMENT'
  }
}

// Deterministic XP-delta preview (NOT authoritative XP): earning events track
// their RP delta; others contribute 0. Authoritative XP comes from the reducer.
function xpDeltaForEvent(eventType: GamificationEventTypeV4, rewardPointsDelta: number): number {
  switch (eventType) {
    case 'TASK_APPROVED':
    case 'BEHAVIOUR_POSITIVE':
    case 'DAILY_GOAL_AWARDED':
    case 'PERFECT_DAY_AWARDED':
    case 'MIGRATION_BASELINE':
      return rewardPointsDelta >= 0 ? rewardPointsDelta : 0
    default:
      return 0
  }
}

function isReversalEventType(eventType: GamificationEventTypeV4): boolean {
  return eventType === 'TASK_REVERSED' || eventType === 'REWARD_REFUNDED'
}

function buildReplayEvent(
  familyId: string,
  source: ReplaySourceRecord,
  classification: ClassificationResultV4,
): GamificationEventV4 {
  const memberId = memberIdFor(source)
  const eventType = eventTypeForSource(source)
  const rewardPointsDelta = classification.rewardPoints ?? 0
  const xpDelta = xpDeltaForEvent(eventType, rewardPointsDelta)
  const eventId = eventIdFor(familyId, memberId, eventType, source.sourceId)
  const reversalOfEventId = isReversalEventType(eventType)
    ? eventIdFor(
        familyId,
        memberId,
        'REVERSED_ORIGINAL',
        (source.raw as { originalSourceId?: string }).originalSourceId ?? source.sourceId,
      )
    : undefined

  return {
    schemaVersion: GAMIFICATION_V4_SCHEMA_VERSION,
    eventId,
    familyId,
    memberId,
    eventType,
    sourceType: source.sourceType as string,
    sourceId: source.sourceId,
    effectiveAt: source.effectiveAt,
    createdAt: source.createdAt,
    rewardPointsDelta,
    xpDelta,
    metadata: {
      sourceType: source.sourceType,
      classification: classification.category,
      estimated: classification.estimated,
      reason: classification.reason,
      evidence: classification.evidence,
    },
    estimated: classification.estimated,
    reversalOfEventId,
  }
}

export function runReplayDryRun(family: LegacyFamily, ctx: ReplayDryRunContext): ReplayDryRunResult {
  const sources: ReplaySourceRecord[] = [
    ...readTaskCompletions(family),
    ...readBehaviours(family),
    ...readDailyPerfectDay(family),
    ...readRedemptions(family),
    ...readRefundsReversals(family),
    ...readAvatarUnlocks(family),
    ...readManualAdjustments(family),
  ]

  const classifyOpts: ClassifyOptions = { taskPointsLookup: ctx.taskPointsLookup, skipIf: ctx.skipIf }
  const classifications = classifyAll(sources, classifyOpts)

  const events: GamificationEventV4[] = []
  for (let i = 0; i < sources.length; i++) {
    const c = classifications[i]
    if (c.category === 'exact' || c.category === 'estimated') {
      events.push(buildReplayEvent(ctx.familyId, sources[i], c))
    }
  }

  const reduceCtx: ReduceContextV4 = {
    updatedAt: ctx.updatedAt,
    projectionVersion: ctx.projectionVersion,
    timezone: ctx.timezone,
  }
  const replayedMembers = rebuildAllMembers(events, reduceCtx)

  const rows: ReplayReportRow[] = buildReportRows(ctx.familyId, sources, classifications)
  const report = emitReport(rows)

  return { ...report, replayedMembers, eventsBuilt: events.length, events: [...events] }
}

interface CliArgs {
  family?: string
  allFamilies: boolean
  fixtures: string
  out?: string
}

function parseArgs(argv: string[]): CliArgs {
  let family: string | undefined
  let allFamilies = false
  let fixtures: string | undefined
  let out: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--family') family = argv[++i]
    else if (a === '--all-families') allFamilies = true
    else if (a === '--fixtures') fixtures = argv[++i]
    else if (a === '--out') out = argv[++i]
  }
  if (!fixtures) throw new Error('missing required --fixtures <dir>')
  if (!family && !allFamilies) throw new Error('specify --family <id> or --all-families')
  return { family, allFamilies, fixtures, out }
}

export function runCli(argv: string[]): number {
  let args: CliArgs
  try {
    args = parseArgs(argv)
  } catch (e) {
    console.error(`replay dry-run: ${(e as Error).message}`)
    console.error('usage: run-dry-run.ts --fixtures <dir> (--family <id> | --all-families) [--out <file>]')
    return 2
  }

  const fixturesDir = resolve(args.fixtures)
  if (!existsSync(fixturesDir)) {
    console.error(`replay dry-run: fixtures dir not found: ${fixturesDir}`)
    return 1
  }

  let files: string[]
  try {
    files = readdirSync(fixturesDir).filter((f) => f.endsWith('.json'))
  } catch (e) {
    console.error(`replay dry-run: cannot read fixtures dir: ${(e as Error).message}`)
    return 1
  }

  const target = `${args.family}.json`
  const selected = args.family ? files.filter((f) => f === target) : files
  if (args.family && selected.length === 0) {
    console.error(`replay dry-run: no fixture for family ${args.family} in ${fixturesDir}`)
    return 1
  }

  const outputs: Record<string, unknown> = {}
  for (const file of selected) {
    let raw: string
    try {
      raw = readFileSync(join(fixturesDir, file), 'utf8')
    } catch (e) {
      console.error(`replay dry-run: cannot read ${file}: ${(e as Error).message}`)
      return 1
    }

    let family: LegacyFamily
    try {
      family = JSON.parse(raw) as LegacyFamily
    } catch (e) {
      console.error(`replay dry-run: invalid JSON in ${file}: ${(e as Error).message}`)
      return 1
    }

    const familyId = family.familyId || file.replace(/\.json$/, '')
    const ctx: ReplayDryRunContext = { familyId, updatedAt: DRY_RUN_UPDATED_AT, projectionVersion: 1 }

    let result: ReplayDryRunResult
    try {
      result = runReplayDryRun(family, ctx)
    } catch (e) {
      console.error(`replay dry-run: family ${familyId} failed: ${(e as Error).message}`)
      return 1
    }

    outputs[familyId] = {
      totalSources: result.totalSources,
      counts: result.counts,
      eventsBuilt: result.eventsBuilt,
      members: Object.keys(result.replayedMembers),
    }
    console.log(
      `family ${familyId}: sources=${result.totalSources} ` +
        `exact=${result.counts.exact} estimated=${result.counts.estimated} ` +
        `malformed=${result.counts.malformed} ambiguous=${result.counts.ambiguous} ` +
        `skipped=${result.counts.skipped} events=${result.eventsBuilt} ` +
        `members=${Object.keys(result.replayedMembers).length}`,
    )
  }

  if (args.out) {
    try {
      writeFileSync(args.out, JSON.stringify(outputs, null, 2))
    } catch (e) {
      console.error(`replay dry-run: cannot write --out ${args.out}: ${(e as Error).message}`)
      return 1
    }
  }

  return 0
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  process.exitCode = runCli(process.argv.slice(2))
}
