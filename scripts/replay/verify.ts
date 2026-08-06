/**
 * Gamification V4 — Task 2.5 replay verification / invariant layer (READ-ONLY).
 *
 * Reuses the existing Stage 1 + Stage 2 components (replay readers, classification
 * engine, report emitter, dry-run pipeline, reducer, rebuild) to prove replay
 * correctness. It does NOT create events, write projections, update Firestore, or
 * migrate data, and does NOT duplicate reducer/ordering/level/streak/achievement/
 * classification logic. No Firestore SDK, no wallet module, no write methods.
 */

import { runReplayDryRun, type ReplayDryRunContext, type ReplayDryRunResult } from './run-dry-run'
import { reduceGamificationEventsV4, type ReduceContextV4 } from '../../src/domain/gamification/v4/reducer'
import { rebuildStateFromLedger } from '../../src/domain/gamification/v4/rebuild'
import { businessFields } from '../../src/domain/gamification/v4/types'
import type { GamificationEventV4, GamificationStateV4 } from '../../src/domain/gamification/v4/event'
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
import { classifyAll } from '../../src/domain/gamification/v4/replay/classify'
import type { ReplayReport } from '../../src/domain/gamification/v4/replay/report'

export interface ReplayVerificationCheck {
  readonly name: string
  readonly passed: boolean
  readonly detail: string
}

export interface ReplayVerificationResult {
  readonly passed: boolean
  readonly checks: readonly ReplayVerificationCheck[]
  readonly report: ReplayReport
  readonly replayedMembers: Readonly<Record<string, GamificationStateV4>>
  readonly reducerRebuildEqual: boolean
  readonly walletDataIncluded: boolean
  readonly hiddenFallbackUsed: boolean
  readonly events: readonly GamificationEventV4[]
}

const WALLET_KEY_PATTERN = /wallet|payment|allowance|pet\s*box|savings|money\s*transfer|currency|amount/i

function reduceContextFor(ctx: ReplayDryRunContext): ReduceContextV4 {
  return { updatedAt: ctx.updatedAt, projectionVersion: ctx.projectionVersion, timezone: ctx.timezone }
}

function stateSignature(members: Readonly<Record<string, GamificationStateV4>>): string {
  const obj: Record<string, unknown> = {}
  for (const k of Object.keys(members).sort()) obj[k] = businessFields(members[k])
  return JSON.stringify(obj)
}

function reportSignature(report: ReplayReport): string {
  return JSON.stringify({ totalSources: report.totalSources, counts: report.counts, rows: report.rows })
}

function seededShuffle<T>(input: readonly T[], seed: number): T[] {
  const arr = [...input]
  let s = seed >>> 0
  for (let i = arr.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0
    const j = s % (i + 1)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function shuffleFamily(family: LegacyFamily): LegacyFamily {
  return {
    ...family,
    taskCompletions: seededShuffle(family.taskCompletions, 1),
    behaviours: seededShuffle(family.behaviours, 2),
    dailyProgress: seededShuffle(family.dailyProgress, 3),
    redemptions: seededShuffle(family.redemptions, 4),
    reversals: seededShuffle(family.reversals, 5),
    avatarUnlocks: seededShuffle(family.avatarUnlocks, 6),
    manualAdjustments: seededShuffle(family.manualAdjustments, 7),
  }
}

function buildSources(family: LegacyFamily): ReplaySourceRecord[] {
  return [
    ...readTaskCompletions(family),
    ...readBehaviours(family),
    ...readDailyPerfectDay(family),
    ...readRedemptions(family),
    ...readRefundsReversals(family),
    ...readAvatarUnlocks(family),
    ...readManualAdjustments(family),
  ]
}

function check(name: string, passed: boolean, detail: string): ReplayVerificationCheck {
  return { name, passed, detail }
}

function deterministicRepeatedCheck(result: ReplayDryRunResult, again: ReplayDryRunResult): ReplayVerificationCheck {
  const sameState = stateSignature(result.replayedMembers) === stateSignature(again.replayedMembers)
  const sameReport = reportSignature(result) === reportSignature(again)
  return check('deterministicRepeated', sameState && sameReport,
    sameState && sameReport ? 'identical replay state and report on repeated run'
      : `repeated run diverged (state=${sameState}, report=${sameReport})`)
}

function shuffledInvarianceCheck(result: ReplayDryRunResult, shuffled: ReplayDryRunResult): ReplayVerificationCheck {
  const sameState = stateSignature(result.replayedMembers) === stateSignature(shuffled.replayedMembers)
  const sameReport = reportSignature(result) === reportSignature(shuffled)
  return check('shuffledInvariance', sameState && sameReport,
    sameState && sameReport ? 'shuffled source order yields identical replay state and report'
      : `shuffled order diverged (state=${sameState}, report=${sameReport})`)
}

function reducerRebuildEqualityCheck(result: ReplayDryRunResult, reduceCtx: ReduceContextV4): ReplayVerificationCheck {
  const byMember: Record<string, GamificationEventV4[]> = {}
  for (const event of result.events) {
    const list = byMember[event.memberId]
    if (list === undefined) byMember[event.memberId] = [event]
    else list.push(event)
  }
  const failures: string[] = []
  for (const [memberId, events] of Object.entries(byMember)) {
    const reduced = reduceGamificationEventsV4(events, reduceCtx)
    const rebuilt = rebuildStateFromLedger(events, reduceCtx)
    const dryRun = result.replayedMembers[memberId]
    const rb = JSON.stringify(businessFields(reduced)) === JSON.stringify(businessFields(rebuilt))
    const rd = dryRun ? JSON.stringify(businessFields(reduced)) === JSON.stringify(businessFields(dryRun)) : false
    if (!rb || !rd) failures.push(`member ${memberId}: reduce==rebuild=${rb} reduce==dryrun=${rd}`)
  }
  return check('reducerRebuildEquality', failures.length === 0,
    failures.length === 0 ? 'reduce == rebuild == dry-run for every member with events' : failures.join('; '))
}

function reportTotalsReconcileCheck(result: ReplayDryRunResult): ReplayVerificationCheck {
  const c = result.counts
  const sum = c.exact + c.estimated + c.malformed + c.ambiguous + c.skipped
  const eventsMatch = result.eventsBuilt === c.exact + c.estimated
  return check('reportTotalsReconcile', sum === result.totalSources && eventsMatch,
    sum === result.totalSources && eventsMatch
      ? `counts sum ${sum} == total ${result.totalSources}; events ${result.eventsBuilt} == exact+estimated`
      : `sum ${sum} vs total ${result.totalSources}; events ${result.eventsBuilt} vs exact+estimated ${c.exact + c.estimated}`)
}

function reportReconciliationCheck(family: LegacyFamily, ctx: ReplayDryRunContext, result: ReplayDryRunResult): ReplayVerificationCheck {
  const classifications = classifyAll(buildSources(family), { taskPointsLookup: ctx.taskPointsLookup, skipIf: ctx.skipIf })
  const classified = { exact: 0, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 }
  for (const c of classifications) classified[c.category] += 1
  const passed = JSON.stringify(classified) === JSON.stringify(result.counts)
  return check('reportReconciliation', passed,
    passed ? 'report counts match classification engine totals'
      : `mismatch: classified=${JSON.stringify(classified)} report=${JSON.stringify(result.counts)}`)
}

function exclusionCheck(result: ReplayDryRunResult, category: 'malformed' | 'ambiguous' | 'skipped'): ReplayVerificationCheck {
  const leaked = result.events.filter((e) => e.metadata?.classification === category)
  return check(`${category}Excluded`, leaked.length === 0,
    leaked.length === 0 ? `no ${category} source entered replay state`
      : `${leaked.length} ${category} source(s) entered replay state (eventIds: ${leaked.map((e) => e.eventId).join(',')})`)
}

function noWalletDataCheck(family: LegacyFamily): ReplayVerificationCheck {
  const found: string[] = []
  const scan = (value: unknown, path: string): void => {
    if (value === null || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (WALLET_KEY_PATTERN.test(key)) found.push(`${path}.${key}`)
      else if (typeof child === 'object' && child !== null) scan(child, `${path}.${key}`)
    }
  }
  scan(family, 'family')
  return check('noWalletData', found.length === 0,
    found.length === 0 ? 'no wallet-like keys detected in any legacy source' : `wallet-like keys detected: ${found.join(', ')}`)
}

function noHiddenFallbackCheck(result: ReplayDryRunResult): ReplayVerificationCheck {
  const issues: string[] = []
  let estimatedCount = 0
  for (const event of result.events) {
    if (typeof event.rewardPointsDelta !== 'number' || Number.isNaN(event.rewardPointsDelta)) {
      issues.push(`${event.eventId}: non-numeric rewardPointsDelta`)
    }
    const metaEstimated = event.metadata?.estimated === true
    if (event.estimated !== metaEstimated) issues.push(`${event.eventId}: estimated flag mismatch`)
    if (metaEstimated) estimatedCount += 1
  }
  if (estimatedCount !== result.counts.estimated) issues.push(`estimated event count ${estimatedCount} != report ${result.counts.estimated}`)
  return check('noHiddenFallback', issues.length === 0,
    issues.length === 0 ? 'all event reward values explicit; estimated flag consistent with classification' : issues.join('; '))
}

/**
 * Verify replay correctness for one legacy family using the existing Stage 1 +
 * Stage 2 components. Pure and read-only. Returns one named check per required
 * invariant plus an overall `passed` flag.
 */
export function verifyReplay(family: LegacyFamily, ctx: ReplayDryRunContext): ReplayVerificationResult {
  const result = runReplayDryRun(family, ctx)
  const reduceCtx = reduceContextFor(ctx)
  const checks: ReplayVerificationCheck[] = []

  checks.push(deterministicRepeatedCheck(result, runReplayDryRun(family, ctx)))
  checks.push(shuffledInvarianceCheck(result, runReplayDryRun(shuffleFamily(family), ctx)))
  checks.push(reducerRebuildEqualityCheck(result, reduceCtx))
  checks.push(reportTotalsReconcileCheck(result))
  checks.push(reportReconciliationCheck(family, ctx, result))
  checks.push(exclusionCheck(result, 'malformed'))
  checks.push(exclusionCheck(result, 'ambiguous'))
  checks.push(exclusionCheck(result, 'skipped'))
  checks.push(noWalletDataCheck(family))
  checks.push(noHiddenFallbackCheck(result))

  const passed = checks.every((c) => c.passed)
  return {
    passed,
    checks,
    report: result,
    replayedMembers: result.replayedMembers,
    reducerRebuildEqual: checks.find((c) => c.name === 'reducerRebuildEquality')?.passed ?? false,
    walletDataIncluded: !(checks.find((c) => c.name === 'noWalletData')?.passed ?? false),
    hiddenFallbackUsed: !(checks.find((c) => c.name === 'noHiddenFallback')?.passed ?? false),
    events: result.events,
  }
}

// ---------------------------------------------------------------------------
// Gate 1 hard assertions (no silent loss)
// ---------------------------------------------------------------------------

/** One explicitly filtered (dropped) source and why it was dropped. */
export interface Gate1FilteredRecord {
  readonly sourceId: string
  readonly reason: string
  readonly evidence: string
}

/** Everything Gate 1 needs to prove that no source disappeared silently. */
export interface Gate1ReconciliationInput {
  readonly totalFamilies: number
  /** Total source documents present in the export/fixtures. */
  readonly exportedSources: number
  /** Total sources the replay pipeline actually processed. */
  readonly reportedSources: number
  readonly counts: {
    readonly exact: number
    readonly estimated: number
    readonly malformed: number
    readonly ambiguous: number
    readonly skipped: number
  }
  /** Every source intentionally filtered before classification, with a reason. */
  readonly filtered: readonly Gate1FilteredRecord[]
}

/**
 * Gate 1 invariants. Pure: returns one named check per invariant.
 *
 *  1. families > 0 && sources == 0 => the mapping is broken.
 *  2. exported == exact + estimated + malformed + ambiguous + skipped + filtered.
 *  3. every filtered row carries a non-empty reason AND evidence.
 *  4. classified total == reported sources (no source vanished mid-pipeline).
 */
export function gate1ReconciliationChecks(
  input: Gate1ReconciliationInput,
): ReplayVerificationCheck[] {
  const c = input.counts
  const classified = c.exact + c.estimated + c.malformed + c.ambiguous + c.skipped
  const filtered = input.filtered.length
  const accounted = classified + filtered

  const checks: ReplayVerificationCheck[] = []

  checks.push(
    check(
      'familiesWithoutSources',
      !(input.totalFamilies > 0 && input.reportedSources === 0),
      input.totalFamilies > 0 && input.reportedSources === 0
        ? `${input.totalFamilies} families produced 0 replay sources: fixture mapping is invalid`
        : `${input.totalFamilies} families produced ${input.reportedSources} sources`,
    ),
  )

  checks.push(
    check(
      'exportedSourcesFullyAccounted',
      input.exportedSources === accounted,
      input.exportedSources === accounted
        ? `exported ${input.exportedSources} == classified ${classified} + explicitly filtered ${filtered}`
        : `UNEXPLAINED COUNT MISMATCH: exported ${input.exportedSources} != classified ${classified} + filtered ${filtered} (${accounted})`,
    ),
  )

  checks.push(
    check(
      'reportedSourcesMatchClassified',
      input.reportedSources === classified,
      input.reportedSources === classified
        ? `reported ${input.reportedSources} == classified ${classified}`
        : `reported ${input.reportedSources} != classified ${classified}`,
    ),
  )

  const unexplained = input.filtered.filter(
    (f) => f.reason.trim().length === 0 || f.evidence.trim().length === 0,
  )
  checks.push(
    check(
      'everyDroppedRecordHasEvidence',
      unexplained.length === 0,
      unexplained.length === 0
        ? `all ${filtered} filtered source(s) carry a reason and evidence`
        : `${unexplained.length} dropped record(s) lack a reason/evidence: ${unexplained
            .map((f) => f.sourceId)
            .join(',')}`,
    ),
  )

  return checks
}

/** Throw (fail closed) when any Gate 1 reconciliation invariant is violated. */
export function assertGate1Reconciliation(input: Gate1ReconciliationInput): void {
  const failures = gate1ReconciliationChecks(input).filter((c) => !c.passed)
  if (failures.length > 0) {
    throw new Error(failures.map((f) => `${f.name}: ${f.detail}`).join(' | '))
  }
}
