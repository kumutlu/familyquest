/**
 * Gamification V4 — trusted-server write contract (Stage 7, Task 7.1 activation).
 *
 * Replaces the blunt `assertEmulatorOnly()` kill switch with an EXPLICIT,
 * fail-closed environment contract, without weakening it:
 *
 *   TEST / EMULATOR
 *     - `FIRESTORE_EMULATOR_HOST` pointing at a local address is still allowed
 *       unconditionally (developer + emulator suites unchanged).
 *
 *   PRODUCTION
 *     - A V4 repository write is permitted ONLY when ALL of the following hold:
 *         1. the process is a trusted first-party server runtime
 *            (Cloud Functions / Admin SDK — never a client SDK), AND
 *         2. an explicit `TrustedV4WriteContext` is active for the current
 *            async execution, AND
 *         3. that context records a PASSED Stage 7 gate verification that has
 *            not expired, AND
 *         4. the context's writer + route match (`task_approval` + `v4`), AND
 *         5. the context's familyId matches the family being written.
 *     - Anything missing, malformed, stale or mismatched => THROW (fail closed).
 *
 * Authorization is derived from *runtime provenance + gate evidence*, never
 * from a shared secret: there is no token here a client could ever present.
 *
 * The active context is carried by `AsyncLocalStorage` and can only be
 * established by wrapping a call (`runWithTrustedV4Write`). It is scoped to one
 * async execution — it is NOT a globally mutable "enabled" flag, cannot leak
 * across concurrent invocations, and is always torn down when the call returns.
 *
 * Client bundles can never reach this module: it lives under `functions/` and
 * imports the Admin-only repository contract. Pinned by
 * `tools/architecture/v4-cutover-boundary.test.ts`.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

const LOCAL_EMULATOR_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

/** Maximum age of a Stage 7 gate verification before it must be re-proven. */
export const TRUSTED_GATE_MAX_AGE_MS = 5 * 60 * 1000

/** Thrown when a production V4 write is attempted without trusted authority. */
export class UntrustedV4WriteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UntrustedV4WriteError'
  }
}

/** Evidence that the mandatory Stage 7 gate passed for this family. */
export interface Stage7GateEvidence {
  readonly passed: true
  /** Epoch ms at which `assertWriterCutoverAllowed` succeeded. */
  readonly verifiedAt: number
}

/**
 * The explicit authority for ONE V4 repository write scope.
 *
 * Constructed only by trusted server code (the Task 7.1 adapter) AFTER the
 * Stage 7 gate has passed for the specific family whose route resolved to v4.
 */
export interface TrustedV4WriteContext {
  readonly trustedServer: true
  readonly writer: 'task_approval'
  readonly route: 'v4'
  readonly familyId: string
  readonly gate: Stage7GateEvidence
}

/**
 * Phase 2 (blocker B2) — the ONE explicit authority under which the Stage 5
 * migration writer may target PRODUCTION.
 *
 * This is deliberately a different shape from `TrustedV4WriteContext`: a
 * migration is an operator-driven, family-scoped, one-shot backfill, not a
 * request-driven runtime writer. It requires:
 *   - `mode: 'production-trusted'` declared by the operator out of band
 *     (`GAMIFICATION_MIGRATION_MODE`, checked as runtime provenance);
 *   - an identified operator;
 *   - the sha256 of the APPROVED Gate 1 artifact the migration consumes;
 *   - `execute: true` — a dry run never establishes this context at all.
 */
export interface TrustedMigrationContext {
  readonly trustedServer: true
  readonly writer: 'migration'
  readonly route: 'migration'
  readonly familyId: string
  /** Identity of the human operator running the migration. */
  readonly operator: string
  /** sha256 of the approved Gate 1 artifact (binds the write to the evidence). */
  readonly gate1Hash: string
  /** Always true: dry runs never establish a write authority. */
  readonly execute: true
  readonly gate: Stage7GateEvidence
}

/**
 * Phase 3 (blocker B3) — READ-ONLY production verification authority.
 *
 * Stage 6 (`verifyPreCutover`) could not see production because every
 * repository read went through the emulator-only guard. This context authorises
 * READS ONLY: it is rejected for every write operation, so it can never be used
 * to mutate production, and a verification run is provably side-effect free.
 */
export interface TrustedReadContext {
  readonly trustedServer: true
  readonly writer: 'verify'
  readonly route: 'read-only'
  readonly familyId: string
  readonly operator: string
}

export type TrustedWriteContext =
  | TrustedV4WriteContext
  | TrustedMigrationContext
  | TrustedReadContext

/** Repository operations that only READ. Everything else is a write. */
const READ_ONLY_OPERATIONS = new Set([
  'readLedger',
  'readEvent',
  'readState',
  'readMigrationMarker',
  'readAllStateMemberIds',
  'verifyPreCutover',
])

/** Environment declaration required for a PRODUCTION migration write. */
export const PRODUCTION_MIGRATION_MODE = 'production-trusted'

const storage = new AsyncLocalStorage<TrustedWriteContext>()

/** True iff FIRESTORE_EMULATOR_HOST points at a local address. */
export function isEmulatorOnlyMode(): boolean {
  const host = process.env.FIRESTORE_EMULATOR_HOST
  if (!host) return false
  const hostPart = host.split(':')[0] || ''
  return LOCAL_EMULATOR_HOSTS.has(hostPart)
}

/**
 * True iff this process is a first-party trusted server runtime.
 *
 * Cloud Functions (gen 2 / Cloud Run) always sets `K_SERVICE`; the gen 1 /
 * functions-framework runtime sets `FUNCTION_TARGET`. A browser or client SDK
 * has neither (and has no `process` at all), so this can never be true for
 * client code. These are runtime facts, NOT client-suppliable credentials.
 */
export function isTrustedServerRuntime(): boolean {
  if (typeof process === 'undefined' || typeof process.env !== 'object') return false
  const service = process.env.K_SERVICE
  const target = process.env.FUNCTION_TARGET
  return (typeof service === 'string' && service.length > 0)
    || (typeof target === 'string' && target.length > 0)
}

/** Read the trusted context active for the current async execution. */
export function currentTrustedV4WriteContext(): TrustedWriteContext | undefined {
  return storage.getStore()
}

/**
 * True iff the operator has explicitly declared a trusted PRODUCTION migration
 * run. This is an operator/runtime fact set out of band on a machine that
 * already holds Admin credentials — it is not, and can never be, presented by
 * a client (this module is unreachable from any client bundle).
 */
export function isTrustedOperatorMigrationRuntime(): boolean {
  if (typeof process === 'undefined' || typeof process.env !== 'object') return false
  return process.env.GAMIFICATION_MIGRATION_MODE === PRODUCTION_MIGRATION_MODE
}

function isValidFamilyId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('/')
}

function isMigrationContext(ctx: unknown): ctx is TrustedMigrationContext {
  if (ctx === null || typeof ctx !== 'object') return false
  const c = ctx as Partial<TrustedMigrationContext>
  return c.trustedServer === true
    && c.writer === 'migration'
    && c.route === 'migration'
    && isValidFamilyId(c.familyId)
    && typeof c.operator === 'string'
    && c.operator.trim().length > 0
    && typeof c.gate1Hash === 'string'
    && c.gate1Hash.length > 0
    && c.execute === true
    && c.gate !== undefined
    && c.gate.passed === true
    && Number.isFinite(c.gate.verifiedAt)
}

function isRuntimeWriterContext(ctx: unknown): ctx is TrustedV4WriteContext {
  if (ctx === null || typeof ctx !== 'object') return false
  const c = ctx as Partial<TrustedV4WriteContext>
  return c.trustedServer === true
    && c.writer === 'task_approval'
    && c.route === 'v4'
    && isValidFamilyId(c.familyId)
    && c.gate !== undefined
    && c.gate.passed === true
    && Number.isFinite(c.gate.verifiedAt)
}

function isReadContext(ctx: unknown): ctx is TrustedReadContext {
  if (ctx === null || typeof ctx !== 'object') return false
  const c = ctx as Partial<TrustedReadContext>
  return c.trustedServer === true
    && c.writer === 'verify'
    && c.route === 'read-only'
    && isValidFamilyId(c.familyId)
    && typeof c.operator === 'string'
    && c.operator.trim().length > 0
}

function isValidContext(ctx: unknown): ctx is TrustedWriteContext {
  return isRuntimeWriterContext(ctx) || isMigrationContext(ctx) || isReadContext(ctx)
}

/**
 * Run `fn` with an explicit trusted-server write authority.
 *
 * The context is validated up front (fail closed on a malformed context) and is
 * automatically discarded when `fn` settles.
 */
export function runWithTrustedV4Write<T>(
  context: TrustedV4WriteContext,
  fn: () => Promise<T>,
): Promise<T> {
  if (!isRuntimeWriterContext(context)) {
    throw new UntrustedV4WriteError(
      'Refusing to establish a V4 write scope: trusted context is missing or malformed.',
    )
  }
  return storage.run(context, fn)
}

/**
 * Run `fn` under an explicit trusted OPERATOR MIGRATION authority (Phase 2).
 *
 * Fails closed when the context is malformed, or when the operator has not
 * declared `GAMIFICATION_MIGRATION_MODE=production-trusted` while targeting a
 * non-emulator Firestore. Scoped to one async execution; torn down on settle.
 */
export function runWithTrustedMigration<T>(
  context: TrustedMigrationContext,
  fn: () => Promise<T>,
): Promise<T> {
  if (!isMigrationContext(context)) {
    throw new UntrustedV4WriteError(
      'Refusing to establish a migration write scope: trusted migration context is missing or malformed.',
    )
  }
  if (!isEmulatorOnlyMode() && !isTrustedOperatorMigrationRuntime()) {
    throw new UntrustedV4WriteError(
      'Refusing to establish a PRODUCTION migration write scope: ' +
        `GAMIFICATION_MIGRATION_MODE must be "${PRODUCTION_MIGRATION_MODE}".`,
    )
  }
  return storage.run(context, fn)
}

/**
 * Run `fn` under a READ-ONLY trusted verification authority (Phase 3).
 *
 * Any write attempted inside this scope is refused by `assertV4WriteAllowed`,
 * so a production Stage 6 verification physically cannot mutate data.
 */
export function runWithTrustedRead<T>(context: TrustedReadContext, fn: () => Promise<T>): Promise<T> {
  if (!isReadContext(context)) {
    throw new UntrustedV4WriteError(
      'Refusing to establish a read-only verification scope: context is missing or malformed.',
    )
  }
  return storage.run(context, fn)
}

/** Options describing the write being authorised. */
export interface V4WriteTarget {
  /** Family partition being written. Must match the trusted context. */
  readonly familyId?: string
  /** Injected clock (tests). */
  readonly now?: () => number
}

/**
 * Fail closed unless this V4 repository write is authorised.
 *
 * Emulator => allowed. Production => requires a trusted server runtime plus a
 * valid, unexpired, family-matched Stage 7 trusted context.
 */
export function assertV4WriteAllowed(operation: string, target: V4WriteTarget = {}): void {
  if (isEmulatorOnlyMode()) return

  const ctx = storage.getStore()
  if (ctx === undefined) {
    throw new UntrustedV4WriteError(
      `Refusing ${operation}: no trusted V4 write context is active. ` +
        'Production V4 writes require an explicit Stage 7 trusted-server scope ' +
        '(or FIRESTORE_EMULATOR_HOST pointing at a local emulator).',
    )
  }
  if (!isValidContext(ctx)) {
    throw new UntrustedV4WriteError(`Refusing ${operation}: trusted V4 write context is malformed.`)
  }
  if (isReadContext(ctx)) {
    if (!READ_ONLY_OPERATIONS.has(operation)) {
      throw new UntrustedV4WriteError(
        `Refusing ${operation}: a read-only verification scope may never write.`,
      )
    }
    if (target.familyId !== undefined && target.familyId !== ctx.familyId) {
      throw new UntrustedV4WriteError(
        `Refusing ${operation}: read scope authorises family ${ctx.familyId}, not ${target.familyId}.`,
      )
    }
    return
  }
  if (isMigrationContext(ctx)) {
    if (!isTrustedOperatorMigrationRuntime()) {
      throw new UntrustedV4WriteError(
        `Refusing ${operation}: production migration requires ` +
          `GAMIFICATION_MIGRATION_MODE=${PRODUCTION_MIGRATION_MODE}.`,
      )
    }
    const migAge = (target.now ?? Date.now)() - ctx.gate.verifiedAt
    if (!Number.isFinite(migAge) || migAge < 0 || migAge > TRUSTED_GATE_MAX_AGE_MS) {
      throw new UntrustedV4WriteError(
        `Refusing ${operation}: Gate 1 migration evidence is stale or invalid (age=${migAge}ms).`,
      )
    }
    if (target.familyId !== undefined && target.familyId !== ctx.familyId) {
      throw new UntrustedV4WriteError(
        `Refusing ${operation}: migration context authorises family ${ctx.familyId}, not ${target.familyId}.`,
      )
    }
    return
  }
  if (!isTrustedServerRuntime()) {
    throw new UntrustedV4WriteError(
      `Refusing ${operation}: not running in a trusted first-party server runtime.`,
    )
  }
  const now = (target.now ?? Date.now)()
  const age = now - ctx.gate.verifiedAt
  if (!Number.isFinite(age) || age < 0 || age > TRUSTED_GATE_MAX_AGE_MS) {
    throw new UntrustedV4WriteError(
      `Refusing ${operation}: Stage 7 gate evidence is stale or invalid (age=${age}ms).`,
    )
  }
  if (target.familyId !== undefined && target.familyId !== ctx.familyId) {
    throw new UntrustedV4WriteError(
      `Refusing ${operation}: trusted context authorises family ${ctx.familyId}, ` +
        `not ${target.familyId}.`,
    )
  }
}
