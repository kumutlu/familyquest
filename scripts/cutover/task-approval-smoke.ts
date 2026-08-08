import type { DocumentData, Firestore } from 'firebase-admin/firestore'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import type { GamificationEventV4 } from '../../src/domain/gamification/v4/event'
import { eventIdFor } from '../../src/domain/gamification/v4/ids'
import { rebuildStateFromLedger } from '../../src/domain/gamification/v4/rebuild'
import {
  businessFields,
  type BusinessFieldsV4,
  type GamificationStateV4,
} from '../../src/domain/gamification/v4/types'
import { createCutoverResolver } from '../../functions/src/gamification/runtimeCutoverConfig'
import { runWithTrustedRead } from '../../functions/src/gamification/v4/trustedServerContext'

export interface LegacySmokeSnapshot {
  userPath: string
  userFields: Record<string, unknown>
  summaryPath: string
  summaryFields: Record<string, unknown> | null
  v1MemberEventCount: number
  v3StatePath: string
  v3StateFields: Record<string, unknown> | null
  v3MemberEventCount: number
}

export interface V4SmokeSnapshot {
  memberEventCount: number
  memberLedger: GamificationEventV4[]
  expectedEvent: GamificationEventV4 | null
  stateBusiness: BusinessFieldsV4 | null
}

export interface TaskApprovalSmokeSnapshot {
  schemaVersion: 1
  phase: 'before' | 'after'
  capturedAt: string
  familyId: string
  memberId: string
  taskId: string
  completionId: string
  timezone: string
  expectedRewardPointsDelta: number
  expectedXpDelta: number
  expectedEventId: string
  route: 'legacy' | 'v4'
  completionApprovedAt?: string
  legacy: LegacySmokeSnapshot
  v4: V4SmokeSnapshot
}

export interface CaptureTaskApprovalSmokeOptions {
  db: Firestore
  phase: 'before' | 'after'
  familyId: string
  memberId: string
  taskId: string
  completionId: string
  now?: () => Date
}

export interface SmokeVerificationResult {
  ok: true
  eventId: string
  rewardPointsDelta: number
  xpDelta: number
  beforeEventCount: number
  afterEventCount: number
}

export class SmokeVerificationError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[task-approval-smoke:${code}] ${message}`)
    this.name = 'SmokeVerificationError'
  }
}

function normalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalise)
  if (value !== null && typeof value === 'object') {
    const withToDate = value as { toDate?: () => Date }
    if (typeof withToDate.toDate === 'function') return withToDate.toDate().toISOString()
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalise(entry)]),
    )
  }
  return value
}

function canonical(value: unknown): string {
  return JSON.stringify(normalise(value))
}

function requireRecord(data: DocumentData | undefined, label: string): Record<string, unknown> {
  if (data === undefined) throw new SmokeVerificationError('SOURCE_MISSING', `${label} does not exist`)
  return normalise(data) as Record<string, unknown>
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('/')) {
    throw new SmokeVerificationError('SOURCE_INVALID', `${label} must be a Firestore document ID`)
  }
  return value
}

function requireAward(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new SmokeVerificationError('SOURCE_INVALID', 'tasks.pointsReward must be a non-negative safe integer')
  }
  return value
}

function selectedUserFields(data: Record<string, unknown>): Record<string, unknown> {
  return {
    rewardPoints: data.rewardPoints ?? null,
    lifetimeXP: data.lifetimeXP ?? null,
    lastTaskCompletionId: data.lastTaskCompletionId ?? null,
  }
}

async function memberEventDocs(
  db: Firestore,
  collectionPath: string,
  memberField: 'childId' | 'memberId',
  memberId: string,
): Promise<DocumentData[]> {
  const snapshot = await db.collection(collectionPath).where(memberField, '==', memberId).get()
  return snapshot.docs.map((doc) => doc.data())
}

export async function captureTaskApprovalSmokeSnapshot(
  options: CaptureTaskApprovalSmokeOptions,
): Promise<TaskApprovalSmokeSnapshot> {
  const { db, familyId, memberId, taskId, completionId, phase } = options
  requireId(familyId, 'familyId')
  requireId(memberId, 'memberId')
  requireId(taskId, 'taskId')
  requireId(completionId, 'completionId')

  const familyPath = `families/${familyId}`
  const userPath = `users/${memberId}`
  const summaryPath = `${familyPath}/gamification_summaries/${memberId}`
  const v3StatePath = `${familyPath}/gamification_state_v3/${memberId}`
  const v4StatePath = `${familyPath}/gamification_state/${memberId}`
  const expectedEventId = eventIdFor(familyId, memberId, 'TASK_APPROVED', completionId)

  const [familySnap, userSnap, taskSnap, completionSnap, summarySnap, v3StateSnap, v4StateSnap,
    v1Events, v3Events, v4EventsSnap] = await Promise.all([
    db.doc(familyPath).get(),
    db.doc(userPath).get(),
    db.doc(`${familyPath}/tasks/${taskId}`).get(),
    db.doc(`${familyPath}/task_completions/${completionId}`).get(),
    db.doc(summaryPath).get(),
    db.doc(v3StatePath).get(),
    db.doc(v4StatePath).get(),
    memberEventDocs(db, `${familyPath}/gamification_events`, 'childId', memberId),
    memberEventDocs(db, `${familyPath}/gamification_events_v3`, 'memberId', memberId),
    db.collection(`${familyPath}/gamification_events`).where('memberId', '==', memberId).get(),
  ])

  const family = requireRecord(familySnap.data(), familyPath)
  const user = requireRecord(userSnap.data(), userPath)
  const task = requireRecord(taskSnap.data(), `${familyPath}/tasks/${taskId}`)
  const completion = requireRecord(completionSnap.data(), `${familyPath}/task_completions/${completionId}`)
  if (completion.assigneeId !== memberId) {
    throw new SmokeVerificationError('SOURCE_INVALID', 'completion.assigneeId does not match memberId')
  }
  if (completion.taskId !== taskId) {
    throw new SmokeVerificationError('SOURCE_INVALID', 'completion.taskId does not match taskId')
  }

  const award = requireAward(task.pointsReward)
  const timezone = typeof family.timezone === 'string' ? family.timezone : 'Europe/London'
  const v4Ledger = v4EventsSnap.docs
    .map((doc) => normalise(doc.data()) as unknown as GamificationEventV4)
    .sort((left, right) => left.eventId.localeCompare(right.eventId))
  const expectedEvent = v4Ledger.find((event) => event.eventId === expectedEventId) ?? null
  const v4State = v4StateSnap.exists
    ? businessFields(normalise(v4StateSnap.data()) as unknown as GamificationStateV4)
    : null
  const approvedAt = completion.approvedAt
  const route = await createCutoverResolver({ db, ttlMs: 0 }).resolveRoute('task_approval', familyId)

  return {
    schemaVersion: 1,
    phase,
    capturedAt: (options.now ?? (() => new Date()))().toISOString(),
    familyId,
    memberId,
    taskId,
    completionId,
    timezone,
    expectedRewardPointsDelta: award,
    expectedXpDelta: award,
    expectedEventId,
    route,
    ...(typeof approvedAt === 'string' ? { completionApprovedAt: approvedAt } : {}),
    legacy: {
      userPath,
      userFields: selectedUserFields(user),
      summaryPath,
      summaryFields: summarySnap.exists
        ? normalise(summarySnap.data()) as Record<string, unknown>
        : null,
      v1MemberEventCount: v1Events.length,
      v3StatePath,
      v3StateFields: v3StateSnap.exists
        ? normalise(v3StateSnap.data()) as Record<string, unknown>
        : null,
      v3MemberEventCount: v3Events.length,
    },
    v4: {
      memberEventCount: v4Ledger.length,
      memberLedger: v4Ledger,
      expectedEvent,
      stateBusiness: v4State,
    },
  }
}

function assertSame(before: unknown, after: unknown, code: string, label: string): void {
  if (canonical(before) !== canonical(after)) {
    throw new SmokeVerificationError(code, `${label} changed between BEFORE and AFTER`)
  }
}

export function verifyTaskApprovalSmoke(
  before: TaskApprovalSmokeSnapshot,
  after: TaskApprovalSmokeSnapshot,
): SmokeVerificationResult {
  if (before.phase !== 'before' || after.phase !== 'after') {
    throw new SmokeVerificationError('PHASE_INVALID', 'snapshots must be BEFORE then AFTER')
  }
  for (const field of ['familyId', 'memberId', 'taskId', 'completionId', 'timezone',
    'expectedRewardPointsDelta', 'expectedXpDelta', 'expectedEventId'] as const) {
    if (canonical(before[field]) !== canonical(after[field])) {
      throw new SmokeVerificationError('IDENTITY_CHANGED', `${field} changed between snapshots`)
    }
  }
  if (before.route !== 'v4' || after.route !== 'v4') {
    throw new SmokeVerificationError('ROUTE_INVALID', 'task_approval route must be v4 for both snapshots')
  }
  if (before.v4.expectedEvent !== null) {
    throw new SmokeVerificationError('V4_EVENT_ALREADY_PRESENT', 'expected smoke event existed before approval')
  }

  const beforeTail = before.v4.memberLedger.at(-1)
  const rebuiltBefore = rebuildStateFromLedger(before.v4.memberLedger, {
    updatedAt: beforeTail?.createdAt ?? before.capturedAt,
    projectionVersion: 1,
    timezone: before.timezone,
  })
  assertSame(
    businessFields(rebuiltBefore),
    before.v4.stateBusiness,
    'V4_BEFORE_STATE_MISMATCH',
    'V4 BEFORE authoritative business state',
  )

  assertSame(before.legacy.userFields, after.legacy.userFields, 'LEGACY_USER_CHANGED', before.legacy.userPath)
  assertSame(before.legacy.summaryFields, after.legacy.summaryFields, 'LEGACY_SUMMARY_CHANGED', before.legacy.summaryPath)
  if (before.legacy.v1MemberEventCount !== after.legacy.v1MemberEventCount) {
    throw new SmokeVerificationError('LEGACY_V1_CHANGED', 'legacy gamification_events member count changed')
  }
  assertSame(before.legacy.v3StateFields, after.legacy.v3StateFields, 'LEGACY_V3_CHANGED', before.legacy.v3StatePath)
  if (before.legacy.v3MemberEventCount !== after.legacy.v3MemberEventCount) {
    throw new SmokeVerificationError('LEGACY_V3_CHANGED', 'gamification_events_v3 member count changed')
  }

  if (after.v4.memberEventCount !== before.v4.memberEventCount + 1
    || after.v4.memberLedger.length !== before.v4.memberLedger.length + 1) {
    throw new SmokeVerificationError('V4_EVENT_COUNT_INVALID', 'operation must add exactly one V4 member event')
  }
  const event = after.v4.expectedEvent
  if (event === null || event.eventId !== before.expectedEventId
    || event.eventType !== 'TASK_APPROVED'
    || event.familyId !== before.familyId
    || event.memberId !== before.memberId
    || event.sourceType !== 'task_completion'
    || event.sourceId !== before.completionId
    || event.rewardPointsDelta !== before.expectedRewardPointsDelta
    || event.xpDelta !== before.expectedXpDelta
    || event.estimated !== false
    || canonical(event.metadata) !== canonical({
      taskId: before.taskId,
      completionId: before.completionId,
      awardedPoints: before.expectedRewardPointsDelta,
    })) {
    throw new SmokeVerificationError('V4_EVENT_INVALID', 'TASK_APPROVED event identity/content/deltas do not match the smoke operation')
  }
  if (after.completionApprovedAt !== undefined && event.effectiveAt !== after.completionApprovedAt) {
    throw new SmokeVerificationError('V4_EVENT_INVALID', 'event effectiveAt does not match completion.approvedAt')
  }

  const expectedAfter = rebuildStateFromLedger([...before.v4.memberLedger, event], {
    updatedAt: event.createdAt,
    projectionVersion: 1,
    timezone: before.timezone,
  })
  assertSame(businessFields(expectedAfter), after.v4.stateBusiness, 'V4_STATE_DELTA_INVALID', 'V4 authoritative business state')

  const rebuiltAfter = rebuildStateFromLedger(after.v4.memberLedger, {
    updatedAt: event.createdAt,
    projectionVersion: 1,
    timezone: after.timezone,
  })
  assertSame(businessFields(rebuiltAfter), after.v4.stateBusiness, 'V4_REBUILD_MISMATCH', 'V4 ledger rebuild')

  return {
    ok: true,
    eventId: event.eventId,
    rewardPointsDelta: event.rewardPointsDelta,
    xpDelta: event.xpDelta,
    beforeEventCount: before.v4.memberEventCount,
    afterEventCount: after.v4.memberEventCount,
  }
}

export interface SmokeSnapshotEnvelope {
  snapshot: TaskApprovalSmokeSnapshot
  sha256: string
}

export function sealSmokeSnapshot(snapshot: TaskApprovalSmokeSnapshot): SmokeSnapshotEnvelope {
  return {
    snapshot,
    sha256: createHash('sha256').update(canonical(snapshot), 'utf8').digest('hex'),
  }
}

export function openSmokeSnapshotEnvelope(raw: string): TaskApprovalSmokeSnapshot {
  const envelope = JSON.parse(raw) as SmokeSnapshotEnvelope
  const expected = createHash('sha256').update(canonical(envelope.snapshot), 'utf8').digest('hex')
  if (envelope.sha256 !== expected) {
    throw new SmokeVerificationError('SNAPSHOT_TAMPERED', 'BEFORE snapshot SHA-256 does not match its contents')
  }
  return envelope.snapshot
}

interface CliArgs {
  mode: 'capture-before' | 'verify-after'
  projectId: string
  familyId: string
  memberId: string
  taskId: string
  completionId: string
  operator: string
  beforeFile: string
  afterFile?: string
}

function parseCliArgs(argv: string[]): CliArgs {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const mode = argv.includes('--capture-before')
    ? 'capture-before'
    : argv.includes('--verify-after') ? 'verify-after' : undefined
  const familyId = value('--family')
  const projectId = value('--project')
  const memberId = value('--member')
  const taskId = value('--task')
  const completionId = value('--completion')
  const operator = value('--operator')
  const beforeFile = value('--before-file')
  if (!mode || !projectId || !familyId || !memberId || !taskId || !completionId || !operator || !beforeFile) {
    throw new Error('required: --capture-before|--verify-after --project --family --member --task --completion --operator --before-file [--after-file]')
  }
  return {
    mode,
    projectId,
    familyId,
    memberId,
    taskId,
    completionId,
    operator,
    beforeFile,
    ...(value('--after-file') ? { afterFile: value('--after-file') } : {}),
  }
}

async function captureInTrustedRead(db: Firestore, args: CliArgs, phase: 'before' | 'after') {
  return runWithTrustedRead({
    trustedServer: true,
    writer: 'verify',
    route: 'read-only',
    familyId: args.familyId,
    operator: args.operator,
  }, () => captureTaskApprovalSmokeSnapshot({
    db,
    phase,
    familyId: args.familyId,
    memberId: args.memberId,
    taskId: args.taskId,
    completionId: args.completionId,
  }))
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseCliArgs(argv)
  const { initializeApp, getApps } = await import('firebase-admin/app')
  const { getFirestore } = await import('firebase-admin/firestore')
  if (getApps().length === 0) initializeApp({ projectId: args.projectId })
  const db = getFirestore()

  if (args.mode === 'capture-before') {
    const before = await captureInTrustedRead(db, args, 'before')
    if (before.route !== 'v4') throw new SmokeVerificationError('ROUTE_INVALID', 'task_approval route is not v4')
    if (before.v4.expectedEvent !== null) {
      throw new SmokeVerificationError('V4_EVENT_ALREADY_PRESENT', 'smoke event already exists before approval')
    }
    writeFileSync(args.beforeFile, `${JSON.stringify(sealSmokeSnapshot(before), null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    console.log(JSON.stringify({ status: 'BEFORE_CAPTURED', file: args.beforeFile, sha256: sealSmokeSnapshot(before).sha256 }))
    return
  }

  const before = openSmokeSnapshotEnvelope(readFileSync(args.beforeFile, 'utf8'))
  const after = await captureInTrustedRead(db, args, 'after')
  const result = verifyTaskApprovalSmoke(before, after)
  if (args.afterFile) {
    writeFileSync(args.afterFile, `${JSON.stringify(sealSmokeSnapshot(after), null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
  }
  console.log(JSON.stringify({ status: 'NO_DUAL_WRITE_PROVED', ...result }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
