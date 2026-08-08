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

const storage = new AsyncLocalStorage<TrustedV4WriteContext>()

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
export function currentTrustedV4WriteContext(): TrustedV4WriteContext | undefined {
  return storage.getStore()
}

function isValidContext(ctx: unknown): ctx is TrustedV4WriteContext {
  if (ctx === null || typeof ctx !== 'object') return false
  const c = ctx as Partial<TrustedV4WriteContext>
  return c.trustedServer === true
    && c.writer === 'task_approval'
    && c.route === 'v4'
    && typeof c.familyId === 'string'
    && c.familyId.length > 0
    && !c.familyId.includes('/')
    && c.gate !== undefined
    && c.gate.passed === true
    && Number.isFinite(c.gate.verifiedAt)
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
  if (!isValidContext(context)) {
    throw new UntrustedV4WriteError(
      'Refusing to establish a V4 write scope: trusted context is missing or malformed.',
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
