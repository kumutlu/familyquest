/**
 * Gamification V4 — Stage 3 / Gate 1 export ingestion (read-only).
 *
 * Converts an OFFICIAL Firestore export (already loaded into a local Firestore
 * emulator via `firebase emulators:start --import <export>`) into deterministic
 * replay fixtures consumable by `scripts/replay/production-report.ts`.
 *
 * Guarantees:
 *  - NEVER connects to production: refuses to run unless FIRESTORE_EMULATOR_HOST
 *    is set, and never uses application default credentials.
 *  - NEVER writes to Firestore: only `.get()` is called.
 *  - NEVER reads wallet collections and never logs wallet values.
 *  - Duplicates no domain logic: reducer/classifier/report stay untouched; this
 *    module only maps raw documents into the existing LegacyFamily shape.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { LegacyFamily } from '../../src/domain/gamification/v4/replay/sources'

/** Legacy Firestore subcollection → fixture field. */
export const LEGACY_COLLECTION_MAP = {
  task_completions: 'taskCompletions',
  behaviour_events: 'behaviours',
  daily_progress: 'dailyProgress',
  redemptions: 'redemptions',
  reversals: 'reversals',
  avatar_unlocks: 'avatarUnlocks',
  manual_adjustments: 'manualAdjustments',
} as const

export type FixtureField = (typeof LEGACY_COLLECTION_MAP)[keyof typeof LEGACY_COLLECTION_MAP]

/** Wallet collections that this tool must never touch. */
export const FORBIDDEN_COLLECTIONS = [
  'wallets',
  'wallet_transactions',
  'savings_goals',
  'funds',
  'fund_transactions',
  'money_requests',
  'transfer_requests',
]

export interface DisplayedMemberState {
  readonly rewardPoints: number
  readonly xpTotal: number
  readonly level: number
}

export interface FamilyFixture extends LegacyFamily {
  readonly displayed: Record<string, DisplayedMemberState>
  readonly tasks: Record<string, number>
}

interface FirestoreLikeTimestamp {
  toDate?: () => Date
  _seconds?: number
  seconds?: number
  _nanoseconds?: number
  nanoseconds?: number
}

/** Normalise any Firestore timestamp representation to a stable ISO string. */
export function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.length > 0 ? value : null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number') return new Date(value).toISOString()
  const ts = value as FirestoreLikeTimestamp
  if (typeof ts.toDate === 'function') return ts.toDate().toISOString()
  const seconds = ts._seconds ?? ts.seconds
  const nanos = ts._nanoseconds ?? ts.nanoseconds ?? 0
  if (typeof seconds === 'number') {
    return new Date(seconds * 1000 + Math.floor(nanos / 1e6)).toISOString()
  }
  return null
}

/** Recursively normalise timestamps inside a raw legacy document. */
export function normalizeDoc(id: string, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { id }
  for (const key of Object.keys(data).sort()) {
    const v = data[key]
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const iso = toIso(v)
      out[key] = iso ?? normalizeDoc('', v as Record<string, unknown>)
      if (iso === null) delete (out[key] as Record<string, unknown>).id
    } else {
      out[key] = v
    }
  }
  return out
}

/**
 * Known production family used as a minimum-sanity anchor: Gate 1 must always
 * find at least one replay source for it. Empty => the fixture mapping is broken.
 */
export const KNOWN_PRODUCTION_FAMILY = '5s4Npeu55wPphLCsGAMP'

/**
 * Production gamification `reversals` is a generic reversal log that also covers
 * wallet/fund reversals. Only gamification-source reversals are replay sources;
 * the rest are dropped (never counted, never read as wallet data).
 */
const REVERSAL_GAMIFICATION_SOURCE_KINDS = new Set(['task_completion', 'reward_redemption'])

/**
 * Translate a raw, normalized legacy document into the field shape the Stage 2
 * readers (src/domain/gamification/v4/replay/sources.ts) expect.
 *
 * ROOT CAUSE OF GATE 1 "ZERO SOURCES": the production export uses DIFFERENT
 * field names than the readers assume. e.g. `task_completions` store the member
 * under `assigneeId` (and `effectSnapshot.childId`), not `childId`, and carry
 * `completedAt` rather than `createdAt`. The readers threw `MalformedSourceError`
 * on the missing fields, which aborted the whole family's replay → 0 sources.
 *
 * This is a pure FIELD-NAME mapping. We never invent or estimate values: every
 * mapped field falls back to the reader-expected name first, then to the
 * production name. Documents that are not gamification replay sources (e.g.
 * wallet/fund reversals) are returned as `null` and dropped by the caller.
 */
export function mapLegacyDoc(
  collection: string,
  doc: Record<string, unknown>,
): Record<string, unknown> | null {
  const effect = (doc.inverseEffectSnapshot ?? doc.originalEffectSnapshot) as
    | Record<string, unknown>
    | undefined
  switch (collection) {
    case 'task_completions': {
      const childId = doc.childId ?? doc.assigneeId ?? (doc.effectSnapshot as Record<string, unknown> | undefined)?.childId
      const createdAt = doc.createdAt ?? doc.completedAt ?? doc.approvedAt
      return { ...doc, childId, createdAt }
    }
    case 'behaviour_events': {
      // Reader expects `behaviourType`; production stores it as `type`.
      return { ...doc, behaviourType: doc.behaviourType ?? doc.type }
    }
    case 'daily_progress': {
      // Reader expects `perfectDay` (boolean) + `rewardPointsAward`; production
      // stores `perfectDayReached` + `approvedPoints`. `createdAt` is `calculatedAt`.
      const createdAt = doc.createdAt ?? doc.calculatedAt ?? doc.finalized
      return {
        ...doc,
        perfectDay: doc.perfectDay ?? doc.perfectDayReached,
        rewardPointsAward: doc.rewardPointsAward ?? doc.approvedPoints,
        createdAt,
      }
    }
    case 'redemptions': {
      const childId = doc.childId ?? doc.userId ?? (doc.effectSnapshot as Record<string, unknown> | undefined)?.childId
      return { ...doc, childId, cost: doc.cost ?? doc.costPaid }
    }
    case 'reversals': {
      const sourceKind = doc.sourceKind
      if (typeof sourceKind !== 'string' || !REVERSAL_GAMIFICATION_SOURCE_KINDS.has(sourceKind)) {
        return null // wallet/fund reversals are not gamification replay sources
      }
      const childId = effect?.childId
      if (typeof childId !== 'string' || childId.length === 0) return null
      const kind: 'REV' | 'REFUND' = sourceKind === 'reward_redemption' ? 'REFUND' : 'REV'
      return {
        ...doc,
        kind,
        originalSourceId: doc.originalSourceId ?? doc.sourceId,
        childId,
        createdAt: doc.createdAt ?? doc.completedAt,
        rewardPointsDelta: doc.rewardPointsDelta ?? effect?.pointsDelta ?? null,
      }
    }
    default:
      return doc
  }
}

/** Sum the replay-source documents across every legacy collection. */
export function countFixtureSources(fixture: FamilyFixture): number {
  return (
    fixture.taskCompletions.length +
    fixture.behaviours.length +
    fixture.dailyProgress.length +
    fixture.redemptions.length +
    fixture.reversals.length +
    fixture.avatarUnlocks.length +
    fixture.manualAdjustments.length
  )
}

/**
 * Decide the export CLI exit code from Gate 1 invariants.
 * Hard failure: families present but zero replay sources => invalid mapping.
 * Sanity: the known production family must yield at least one source.
 */
export function decideExportExitCode(opts: {
  familyCount: number
  totalSources: number
  knownFamilySources?: number
}): number {
  if (opts.familyCount > 0 && opts.totalSources === 0) return 1
  if (opts.knownFamilySources !== undefined && opts.knownFamilySources === 0) return 1
  return 0
}

/** Fail closed if any read collection is a forbidden (wallet) collection. */
export function assertReadCollectionsSafe(readCollections: readonly string[]): void {
  for (const c of readCollections) {
    if ((FORBIDDEN_COLLECTIONS as readonly string[]).includes(c)) {
      throw new Error(`export-to-fixtures: attempted to read forbidden collection "${c}"`)
    }
  }
}

/** Build a deterministic fixture from already-read raw collections. */
export function buildFixture(
  familyId: string,
  raw: Readonly<Record<string, ReadonlyArray<{ id: string; data: Record<string, unknown> }>>>,
  summaries: ReadonlyArray<{ id: string; data: Record<string, unknown> }> = [],
  tasks: ReadonlyArray<{ id: string; data: Record<string, unknown> }> = [],
): FamilyFixture {
  const fixture: Record<string, unknown> = { familyId }
  for (const field of Object.values(LEGACY_COLLECTION_MAP)) {
    fixture[field] = []
  }
  for (const [collection, field] of Object.entries(LEGACY_COLLECTION_MAP)) {
    const docs = raw[collection] ?? []
    fixture[field] = docs
      .map((d) => mapLegacyDoc(collection, normalizeDoc(d.id, d.data)))
      .filter((d): d is Record<string, unknown> => d !== null)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
  }

  const displayed: Record<string, DisplayedMemberState> = {}
  for (const s of [...summaries].sort((a, b) => a.id.localeCompare(b.id))) {
    displayed[s.id] = {
      rewardPoints: Number(s.data.rewardPoints ?? 0),
      xpTotal: Number(s.data.xpTotal ?? s.data.totalXp ?? 0),
      level: Number(s.data.level ?? 1),
    }
  }

  const taskPoints: Record<string, number> = {}
  for (const t of [...tasks].sort((a, b) => a.id.localeCompare(b.id))) {
    // Production `tasks` store the reward under `pointsReward`.
    const points = t.data.points ?? t.data.rewardPoints ?? t.data.pointsValue ?? t.data.pointsReward
    if (typeof points === 'number') taskPoints[t.id] = points
  }

  return { ...(fixture as unknown as LegacyFamily), displayed, tasks: taskPoints }
}

// ---------------------------------------------------------------------------
// Emulator-only reading (no production credentials are ever constructed)
// ---------------------------------------------------------------------------

export class ProductionAccessError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductionAccessError'
  }
}

/** Fail closed unless we are demonstrably pointed at a local emulator. */
export function assertEmulator(env: NodeJS.ProcessEnv = process.env): string {
  const host = env.FIRESTORE_EMULATOR_HOST
  if (!host) {
    throw new ProductionAccessError(
      'FIRESTORE_EMULATOR_HOST is not set. This tool only reads a Firestore emulator ' +
        'loaded from an official export; it must never touch production.',
    )
  }
  if (!/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):\d+$/.test(host)) {
    throw new ProductionAccessError(`FIRESTORE_EMULATOR_HOST must be local, got: ${host}`)
  }
  return host
}

interface MinimalSnapshot {
  docs: ReadonlyArray<{ id: string; data: () => Record<string, unknown> }>
}
interface MinimalDb {
  collection: (p: string) => {
    get: () => Promise<MinimalSnapshot>
    doc: (id: string) => { collection: (p: string) => { get: () => Promise<MinimalSnapshot> } }
  }
}

function toEntries(snap: MinimalSnapshot | undefined, path: string) {
  if (!snap || !Array.isArray(snap.docs)) {
    throw new Error(`export-to-fixtures: unexpected empty snapshot for ${path}`)
  }
  return snap.docs.map((d) => ({ id: d.id, data: d.data() }))
}

/** Read one family's legacy gamification collections (read-only). */
export async function readFamily(db: MinimalDb, familyId: string): Promise<FamilyFixture> {
  // Sanity: never read a wallet/forbidden collection.
  assertReadCollectionsSafe([
    ...Object.keys(LEGACY_COLLECTION_MAP),
    'gamification_summaries',
    'tasks',
  ])
  const famRef = db.collection('families').doc(familyId)
  const raw: Record<string, Array<{ id: string; data: Record<string, unknown> }>> = {}
  for (const collection of Object.keys(LEGACY_COLLECTION_MAP)) {
    const snap = await famRef.collection(collection).get()
    raw[collection] = toEntries(snap, `families/${familyId}/${collection}`)
  }
  const summaries = toEntries(
    await famRef.collection('gamification_summaries').get(),
    `families/${familyId}/gamification_summaries`,
  )
  const tasks = toEntries(await famRef.collection('tasks').get(), `families/${familyId}/tasks`)
  return buildFixture(familyId, raw, summaries, tasks)
}

export interface CliArgs {
  out: string
  family?: string
}

export function parseArgs(argv: readonly string[]): CliArgs {
  let out: string | undefined
  let family: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') out = argv[++i]
    else if (a === '--family') family = argv[++i]
    else throw new Error(`unknown argument: ${a}`)
  }
  if (!out) throw new Error('missing required --out <dir>')
  return { out, family }
}

export async function runCli(argv: readonly string[]): Promise<number> {
  let args: CliArgs
  try {
    args = parseArgs(argv)
    assertEmulator()
  } catch (e) {
    console.error(`export-to-fixtures: ${(e as Error).message}`)
    console.error('usage: export-to-fixtures.ts --out <dir> [--family <id>]  (FIRESTORE_EMULATOR_HOST required)')
    return 2
  }

  // Use the shared modular initializer (getApps/initializeApp/getFirestore).
  // Emulator-only: never constructs application default credentials, so
  // production can never be reached.
  const require = createRequire(import.meta.url)
  const { initFirestore } = require('../firebase-admin-init.cjs') as {
    initFirestore: (opts: { emulator?: boolean }) => MinimalDb
  }
  const db = initFirestore({ emulator: true })

  const familyIds = args.family
    ? [args.family]
    : toEntries(await db.collection('families').get(), 'families').map((f) => f.id).sort()

  const outDir = resolve(args.out)
  mkdirSync(outDir, { recursive: true })
  for (const familyId of familyIds) {
    const fixture = await readFamily(db, familyId)
    writeFileSync(join(outDir, `${familyId}.json`), JSON.stringify(fixture, null, 2) + '\n')
    console.log(`export-to-fixtures: wrote ${familyId}.json`)
  }

  // --- Gate 1 invariants: count sources and fail closed if invalid. ---
  let totalSources = 0
  let knownFamilySources: number | undefined
  for (const familyId of familyIds) {
    const fixture = JSON.parse(readFileSync(join(outDir, `${familyId}.json`), 'utf8')) as FamilyFixture
    const n = countFixtureSources(fixture)
    totalSources += n
    if (familyId === KNOWN_PRODUCTION_FAMILY) knownFamilySources = n
  }

  const exitCode = decideExportExitCode({
    familyCount: familyIds.length,
    totalSources,
    knownFamilySources,
  })
  if (exitCode !== 0) {
    console.error('export-to-fixtures: No replay sources found; fixture mapping is invalid.')
    return exitCode
  }

  console.log(
    `export-to-fixtures: ${familyIds.length} families → ${outDir} (totalSources=${totalSources})`,
  )
  return 0
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
