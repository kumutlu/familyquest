import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import {
  getFirestore,
  type DocumentData,
  type Firestore,
  type Timestamp,
} from 'firebase-admin/firestore'
import { legacyBaselineEventId } from '../src/domain/gamification/xp'

const SCHEMA_VERSION = 1 as const
const BASELINE_SOURCE_ID = 'legacy_lifetime_xp'
const BASELINE_CREATED_BY = 'legacy-xp-migration-v1'

type MigrationStatus = 'inactive' | 'prepared' | 'baseline_complete' | 'active'

export interface SemanticCursor {
  readonly effectiveAt: Timestamp
  readonly causalGroupId: string
  readonly transitionRank: number
  readonly documentId: string
}

interface MigrationMetadata {
  readonly schemaVersion: 1
  readonly status: MigrationStatus
  readonly cutoverAt?: Timestamp
}

interface LegacyBaselineEvent {
  readonly schemaVersion: 1
  readonly familyId: string
  readonly childId: string
  readonly eventType: 'legacy_xp_baseline'
  readonly xpDelta: number
  readonly sourceType: 'migration'
  readonly sourceId: 'legacy_lifetime_xp'
  readonly idempotencyKey: string
  readonly causalGroupId: string
  readonly effectiveAt: Timestamp
  readonly transitionRank: 0
  readonly configSchemaVersion: 1
  readonly createdBy: 'legacy-xp-migration-v1'
  readonly createdAt: Timestamp
  readonly migratedAt: Timestamp
}

export interface LegacyBaselineSemanticPosition {
  readonly effectiveAt: Timestamp
  readonly causalGroupId: string
  readonly transitionRank: number
  readonly idempotencyKey: string
}

export interface LegacyBaselineSummaryPlan {
  readonly action: 'create' | 'update' | 'none'
  readonly dirtyCursor: SemanticCursor
  readonly writeData?: DocumentData
}

export interface MigrateLegacyXpArgs {
  readonly familyId?: string
  readonly execute: boolean
  /** Injected only for deterministic tests; production captures Timestamp.now() once. */
  readonly runAt?: Timestamp
  /** Test-only observer invoked after a child transaction has read its bounded inputs. */
  readonly afterChildTransactionRead?: (context: Readonly<{ familyId: string; childId: string }>) => Promise<void>
}

export interface LegacyXpMigrationResult {
  readonly families: number
  readonly eligible: number
  readonly created: number
  readonly verified: number
  readonly skipped: number
}

function isTimestamp(value: unknown): value is Timestamp {
  return value !== null && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function'
}

function assertTimestamp(value: unknown, label: string): asserts value is Timestamp {
  if (!isTimestamp(value)) throw new Error(`${label} must be an Admin Timestamp`)
}

function assertFamilyId(familyId: string): void {
  if (familyId.length === 0 || familyId.includes('/')) throw new Error('familyId must be a non-empty Firestore document ID')
}

function assertPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareCursors(left: SemanticCursor, right: SemanticCursor): number {
  const effectiveAt = left.effectiveAt.toMillis() - right.effectiveAt.toMillis()
  if (effectiveAt !== 0) return effectiveAt
  const group = compareCodeUnits(left.causalGroupId, right.causalGroupId)
  if (group !== 0) return group
  if (left.transitionRank !== right.transitionRank) return left.transitionRank - right.transitionRank
  return compareCodeUnits(left.documentId, right.documentId)
}

function cursorEqual(left: unknown, right: SemanticCursor): boolean {
  if (left === null || typeof left !== 'object') return false
  const candidate = left as Partial<SemanticCursor>
  return isTimestamp(candidate.effectiveAt)
    && candidate.effectiveAt.toMillis() === right.effectiveAt.toMillis()
    && candidate.causalGroupId === right.causalGroupId
    && candidate.transitionRank === right.transitionRank
    && candidate.documentId === right.documentId
}

function readCursor(value: unknown): SemanticCursor | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const cursor = value as Partial<SemanticCursor>
  if (!isTimestamp(cursor.effectiveAt) || typeof cursor.causalGroupId !== 'string'
    || !Number.isInteger(cursor.transitionRank) || typeof cursor.documentId !== 'string') return undefined
  return cursor as SemanticCursor
}

function migrationMetadata(value: unknown): MigrationMetadata | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const migration = value as Partial<MigrationMetadata>
  if (migration.schemaVersion !== SCHEMA_VERSION
    || !['inactive', 'prepared', 'baseline_complete', 'active'].includes(migration.status ?? '')) return undefined
  if (migration.cutoverAt !== undefined && !isTimestamp(migration.cutoverAt)) return undefined
  return migration as MigrationMetadata
}

function expectedBaseline(familyId: string, childId: string, lifetimeXP: number, cutoverAt: Timestamp, runAt: Timestamp): LegacyBaselineEvent {
  const idempotencyKey = legacyBaselineEventId(familyId, childId)
  return {
    schemaVersion: SCHEMA_VERSION,
    familyId,
    childId,
    eventType: 'legacy_xp_baseline',
    xpDelta: lifetimeXP,
    sourceType: 'migration',
    sourceId: BASELINE_SOURCE_ID,
    idempotencyKey,
    causalGroupId: idempotencyKey,
    effectiveAt: cutoverAt,
    transitionRank: 0,
    configSchemaVersion: SCHEMA_VERSION,
    createdBy: BASELINE_CREATED_BY,
    createdAt: runAt,
    migratedAt: runAt,
  }
}

function semanticEventMatches(actual: DocumentData, expected: LegacyBaselineEvent): boolean {
  const { createdAt: _createdAt, migratedAt: _migratedAt, ...semanticExpected } = expected
  if (!isTimestamp(actual.createdAt) || !isTimestamp(actual.migratedAt)) return false
  const actualKeys = Object.keys(actual).filter(key => key !== 'createdAt' && key !== 'migratedAt').sort(compareCodeUnits)
  const expectedKeys = Object.keys(semanticExpected).sort(compareCodeUnits)
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) return false
  return expectedKeys.every(key => {
    const expectedValue = semanticExpected[key as keyof typeof semanticExpected]
    const actualValue = actual[key]
    return isTimestamp(expectedValue) ? isTimestamp(actualValue) && expectedValue.toMillis() === actualValue.toMillis() : actualValue === expectedValue
  })
}

function baselineCursor(event: LegacyBaselineSemanticPosition): SemanticCursor {
  return {
    effectiveAt: event.effectiveAt,
    causalGroupId: event.causalGroupId,
    transitionRank: event.transitionRank,
    documentId: event.idempotencyKey,
  }
}

function mergedDirtyCursor(current: unknown, next: SemanticCursor): SemanticCursor {
  const existing = readCursor(current)
  return existing !== undefined && compareCursors(existing, next) <= 0 ? existing : next
}

function summaryNeedsDirtyMarker(summary: DocumentData | undefined, dirtyCursor: SemanticCursor): boolean {
  return summary?.rebuildRequired !== true
    || summary.projectionStatus !== 'rebuilding'
    || !cursorEqual(summary.earliestDirtyCursor, dirtyCursor)
}

function dirtySummary(familyId: string, childId: string, dirtyCursor: SemanticCursor, runAt: Timestamp): DocumentData {
  return {
    schemaVersion: SCHEMA_VERSION,
    familyId,
    childId,
    xpTotal: 0,
    level: 1,
    currentStreak: 0,
    bestStreak: 0,
    perfectDayCount: 0,
    lastQualifiedDayKey: null,
    projectionRevision: 0,
    foldedThrough: null,
    rebuildRequired: true,
    earliestDirtyCursor: dirtyCursor,
    projectionStatus: 'rebuilding',
    updatedAt: runAt,
  }
}

/**
 * Plans the summary write from the transaction's current snapshot. Keeping this
 * pure lets a Firestore transaction callback safely be re-entered with a newer
 * summary snapshot without ever moving the dirty cursor forward.
 */
export function planLegacyBaselineSummary(
  summary: DocumentData | undefined,
  familyId: string,
  childId: string,
  baseline: LegacyBaselineSemanticPosition,
  runAt: Timestamp,
): LegacyBaselineSummaryPlan {
  const dirtyCursor = mergedDirtyCursor(summary?.earliestDirtyCursor, baselineCursor(baseline))
  if (!summaryNeedsDirtyMarker(summary, dirtyCursor)) return { action: 'none', dirtyCursor }
  if (summary === undefined) {
    return { action: 'create', dirtyCursor, writeData: dirtySummary(familyId, childId, dirtyCursor, runAt) }
  }
  return {
    action: 'update',
    dirtyCursor,
    writeData: {
      rebuildRequired: true,
      earliestDirtyCursor: dirtyCursor,
      projectionStatus: 'rebuilding',
      updatedAt: runAt,
    },
  }
}

function preparedMigration(data: DocumentData | undefined, familyId: string): MigrationMetadata {
  const migration = migrationMetadata(data?.gamificationMigration)
  if (migration?.status !== 'prepared' || migration.cutoverAt === undefined) {
    throw new Error(`Family ${familyId} must be prepared with a frozen cutoverAt before baseline migration`)
  }
  return migration
}

export async function prepareGamificationMigration(db: Firestore, familyId: string, cutoverAt: Timestamp): Promise<MigrationMetadata> {
  assertFamilyId(familyId)
  assertTimestamp(cutoverAt, 'cutoverAt')
  const familyRef = db.collection('families').doc(familyId)
  return db.runTransaction(async transaction => {
    const family = await transaction.get(familyRef)
    if (!family.exists) throw new Error(`Family ${familyId} does not exist`)
    const rawMetadata = family.data()?.gamificationMigration
    const current = migrationMetadata(rawMetadata)
    if (rawMetadata !== undefined && current === undefined) {
      throw new Error(`Family ${familyId} has malformed gamification migration metadata`)
    }
    if (current !== undefined && current.status !== 'inactive') {
      throw new Error(`Family ${familyId} must be inactive before preparation`)
    }
    const prepared = { schemaVersion: SCHEMA_VERSION, status: 'prepared' as const, cutoverAt }
    transaction.update(familyRef, { gamificationMigration: prepared })
    return prepared
  })
}

async function familyIds(db: Firestore, scope: string | undefined): Promise<readonly string[]> {
  if (scope !== undefined) {
    assertFamilyId(scope)
    return [scope]
  }
  return (await db.collection('families').get()).docs.map(document => document.id).sort(compareCodeUnits)
}

async function inspectChild(
  db: Firestore,
  familyId: string,
  childId: string,
  lifetimeXP: number,
  runAt: Timestamp,
  afterChildTransactionRead: MigrateLegacyXpArgs['afterChildTransactionRead'],
): Promise<'created' | 'verified'> {
  const familyRef = db.collection('families').doc(familyId)
  const userRef = db.collection('users').doc(childId)
  const eventId = legacyBaselineEventId(familyId, childId)
  const eventRef = familyRef.collection('gamification_events').doc(eventId)
  const summaryRef = familyRef.collection('gamification_summaries').doc(childId)

  return db.runTransaction(async transaction => {
    const family = await transaction.get(familyRef)
    const user = await transaction.get(userRef)
    const event = await transaction.get(eventRef)
    const summary = await transaction.get(summaryRef)
    const migration = preparedMigration(family.data(), familyId)
    const userData = user.data()
    if (!user.exists || userData?.familyId !== familyId || userData.role !== 'child') {
      throw new Error(`User ${childId} is no longer a child in family ${familyId}`)
    }
    if (userData.lifetimeXP !== lifetimeXP) {
      throw new Error(`User ${childId} lifetimeXP changed while migrating; retry the family pass`)
    }
    await afterChildTransactionRead?.({ familyId, childId })
    const expected = expectedBaseline(familyId, childId, lifetimeXP, migration.cutoverAt!, runAt)
    const outcome = event.exists ? 'verified' : 'created'
    if (event.exists && !semanticEventMatches(event.data()!, expected)) {
      throw new Error(`Existing baseline event ${eventId} has conflicting immutable semantics`)
    }
    const summaryPlan = planLegacyBaselineSummary(summary.data(), familyId, childId, expected, runAt)
    if (!event.exists) transaction.create(eventRef, expected)
    if (summaryPlan.action === 'create') transaction.create(summaryRef, summaryPlan.writeData!)
    if (summaryPlan.action === 'update') transaction.update(summaryRef, summaryPlan.writeData!)
    return outcome
  })
}

export async function migrateLegacyXp(db: Firestore, args: MigrateLegacyXpArgs): Promise<LegacyXpMigrationResult> {
  const runAt = args.runAt ?? (await import('firebase-admin/firestore')).Timestamp.now()
  assertTimestamp(runAt, 'runAt')
  const result = { families: 0, eligible: 0, created: 0, verified: 0, skipped: 0 }
  for (const familyId of await familyIds(db, args.familyId)) {
    const family = await db.collection('families').doc(familyId).get()
    const migration = preparedMigration(family.data(), familyId)
    const children = await db.collection('users').where('familyId', '==', familyId).where('role', '==', 'child').get()
    result.families += 1
    for (const child of children.docs) {
      const lifetimeXP = child.data().lifetimeXP
      if (!assertPositiveSafeInteger(lifetimeXP)) {
        result.skipped += 1
        continue
      }
      result.eligible += 1
      const expected = expectedBaseline(familyId, child.id, lifetimeXP, migration.cutoverAt!, runAt)
      const existing = await db.collection('families').doc(familyId).collection('gamification_events').doc(expected.idempotencyKey).get()
      if (!args.execute) {
        if (existing.exists && !semanticEventMatches(existing.data()!, expected)) {
          throw new Error(`Existing baseline event ${expected.idempotencyKey} has conflicting immutable semantics`)
        }
        if (existing.exists) result.verified += 1
        else result.created += 1
        continue
      }
      const outcome = await inspectChild(db, familyId, child.id, lifetimeXP, runAt, args.afterChildTransactionRead)
      result[outcome] += 1
    }
  }
  return result
}

interface CliArgs {
  readonly projectId: string
  readonly familyId?: string
  readonly execute: boolean
}

function parseCliArgs(argv: readonly string[]): CliArgs {
  let projectId: string | undefined
  let familyId: string | undefined
  let mode: 'dry-run' | 'execute' | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--project' || argument === '--family-id') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${argument} requires a value`)
      if (argument === '--project') {
        if (projectId !== undefined) throw new Error('--project may appear only once')
        projectId = value
      } else {
        if (familyId !== undefined) throw new Error('--family-id may appear only once')
        familyId = value
      }
      index += 1
    } else if (argument === '--dry-run' || argument === '--execute') {
      if (mode !== undefined) throw new Error('Choose exactly one of --dry-run or --execute')
      mode = argument.slice(2) as 'dry-run' | 'execute'
    } else {
      throw new Error(`Unknown argument: ${argument}`)
    }
  }
  if (projectId === undefined || projectId.length === 0) throw new Error('--project is required')
  if (mode === undefined) throw new Error('Choose exactly one of --dry-run or --execute')
  return { projectId, familyId, execute: mode === 'execute' }
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2))
  const name = `migrate-legacy-xp-${args.projectId}`
  const app = getApps().find(candidate => candidate.name === name)
    ?? initializeApp({ credential: applicationDefault(), projectId: args.projectId }, name)
  const result = await migrateLegacyXp(getFirestore(app), { familyId: args.familyId, execute: args.execute })
  console.log(JSON.stringify({ mode: args.execute ? 'execute' : 'dry-run', ...result }))
}

if (process.argv[1]?.endsWith('migrate-legacy-xp.ts')) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
