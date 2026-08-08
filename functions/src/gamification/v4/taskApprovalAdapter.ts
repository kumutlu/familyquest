/**
 * Gamification V4 — real trigger adapter for the task-approval writer
 * (Stage 7, Task 7.1 production-ACTIVATION readiness).
 *
 * This is the ONLY place the deployed Cloud Functions entry point
 * (`functions/src/index.ts` -> `createGamificationTriggers` ->
 * `processApprovedCompletion`) is wired to the V4 engine. It exists so that
 * Task 7.1 is *activatable*; it does NOT activate anything:
 *
 *   - The route is resolved by `resolveWriterRouteSafe` inside
 *     `gamificationProcessor.processApprovedCompletion`. The default resolver is
 *     all-legacy, so this engine is CONSTRUCTED but NEVER CALLED in production
 *     today.
 *   - There is no dual write: the processor picks exactly one branch. This
 *     adapter never touches a legacy collection and never calls the legacy
 *     repository.
 *   - There is no second processor: the actual write is delegated to the Task
 *     7.1 writer (`applyTaskApprovalV4`), which persists through the Stage 4
 *     repository and rebuilds state with `rebuildStateFromLedger`.
 *   - Before any production write the mandatory Stage 7 gate is re-verified for
 *     the specific family, and the write runs inside an explicit, expiring,
 *     family-scoped trusted-server context (see `trustedServerContext.ts`).
 *     Gate failure => zero writers run (the error propagates; the legacy writer
 *     is never used as a fallback).
 */

import type { Firestore } from 'firebase-admin/firestore'

import {
  applyTaskApprovalV4,
  type TaskApprovalFactsV4,
} from './taskApprovalWriter'
import {
  runWithTrustedV4Write,
  type TrustedV4WriteContext,
} from './trustedServerContext'
import { Stage7EvidenceUnavailableError as Stage7EvidenceUnavailableErrorImpl } from './stage7Verifier'
import type {
  GamificationProcessResult,
  GamificationV4TaskApprovalEngine,
  ProcessApprovedCompletionArgs,
} from '../../gamificationProcessor'

/** Thrown when the approved completion cannot be mapped to V4 facts. */
export class TaskApprovalFactsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaskApprovalFactsError'
  }
}

/**
 * Task 7.1 wiring surface. The deployed entry point may only import THIS module
 * (pinned by the architecture boundary test), so the real Stage 7 verifier is
 * re-exported here. The verifier itself is read-only and delegates every
 * decision to `assertWriterCutoverAllowed` (Gate 1 + Gate 2 + Stage 6).
 */
export {
  createStage7WriterVerifier,
  Stage7EvidenceUnavailableError,
  Stage7EvidenceRefusedError,
  DEFAULT_MAX_EVIDENCE_AGE_MS,
  type Stage7ApprovedEvidence,
  type Stage7WriterVerifierDeps,
} from './stage7Verifier'

/**
 * The fail-closed placeholder verifier: always denies.
 *
 * Retained for tests and for any writer that has NOT been provisioned with
 * approved Stage 7 evidence. The deployed task-approval path now uses the real
 * verifier (`createStage7WriterVerifier`).
 */
export const denyStage7ByDefault: VerifyStage7ForFamily = async (familyId) => {
  throw new Stage7EvidenceUnavailableErrorImpl(familyId)
}

/**
 * Verify the mandatory Stage 7 gate for ONE family.
 *
 * Injected (not imported) so the deployed bundle does not hard-wire a specific
 * evidence source, and so tests can prove gate-failure => zero writers. It must
 * THROW when the family is not cleared for V4.
 */
export type VerifyStage7ForFamily = (familyId: string) => Promise<void>

/** Load the already-decided award facts for an approved completion. */
export type LoadTaskApprovalFacts = (
  db: Firestore,
  args: ProcessApprovedCompletionArgs,
) => Promise<TaskApprovalFactsV4 | null>

export interface V4TaskApprovalAdapterDeps {
  readonly db: Firestore
  readonly verifyStage7: VerifyStage7ForFamily
  readonly loadFacts?: LoadTaskApprovalFacts
  readonly now?: () => number
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('/')) {
    throw new TaskApprovalFactsError(`${label} must be a non-empty Firestore document ID`)
  }
  return value
}

function requireCount(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TaskApprovalFactsError(`${label} must be a non-negative safe integer`)
  }
  return value
}

function toIso(value: unknown, fallback: number): string {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString()
  if (typeof value === 'string' && value.length > 0) return new Date(value).toISOString()
  const seconds = (value as { _seconds?: number } | null)?._seconds
  if (typeof seconds === 'number') return new Date(seconds * 1000).toISOString()
  const toDate = (value as { toDate?: () => Date } | null)?.toDate
  if (typeof toDate === 'function') return (value as { toDate: () => Date }).toDate().toISOString()
  return new Date(fallback).toISOString()
}

/**
 * Default facts loader: reads the SAME documents the legacy writer reads and
 * performs NO new award arithmetic — the award value is `task.pointsReward`,
 * exactly as the legacy effect (`rewardPointsAward`/`xpAward`) defines it.
 * Returns `null` when the completion is not an approved award (ignored).
 */
export const loadTaskApprovalFactsFromFirestore: LoadTaskApprovalFacts = async (db, args) => {
  const familyRef = db.doc(`families/${args.familyId}`)
  const [familySnap, completionSnap] = await Promise.all([
    familyRef.get(),
    familyRef.collection('task_completions').doc(args.completionId).get(),
  ])
  if (!familySnap.exists) throw new TaskApprovalFactsError(`Family ${args.familyId} does not exist`)
  if (!completionSnap.exists) throw new TaskApprovalFactsError(`Completion ${args.completionId} does not exist`)

  const completion = completionSnap.data() as Record<string, unknown>
  if (completion.status !== 'approved') return null

  const memberId = requireString(completion.assigneeId, 'assigneeId')
  const taskId = requireString(completion.taskId, 'taskId')

  const taskSnap = await familyRef.collection('tasks').doc(taskId).get()
  if (!taskSnap.exists) throw new TaskApprovalFactsError(`Task ${taskId} does not exist`)
  const award = requireCount((taskSnap.data() as Record<string, unknown>).pointsReward, 'pointsReward')

  const family = familySnap.data() as Record<string, unknown>
  const timezone = typeof family.timezone === 'string' ? family.timezone : undefined

  return {
    familyId: args.familyId,
    memberId,
    completionId: args.completionId,
    taskId,
    rewardPointsDelta: award,
    xpDelta: award,
    effectiveAt: toIso(completion.approvedAt, args.processingAt),
    createdAt: new Date(args.processingAt).toISOString(),
    ...(timezone !== undefined ? { timezone } : {}),
  }
}

/**
 * Construct the real V4 task-approval engine injected into the deployed
 * gamification trigger. Constructing it has NO side effects and performs no
 * I/O — it becomes reachable only if the route resolves to `v4`.
 */
export function createV4TaskApprovalEngine(
  deps: V4TaskApprovalAdapterDeps,
): GamificationV4TaskApprovalEngine {
  const loadFacts = deps.loadFacts ?? loadTaskApprovalFactsFromFirestore
  const now = deps.now ?? (() => Date.now())

  return {
    async processApprovedCompletion(
      args: ProcessApprovedCompletionArgs,
    ): Promise<GamificationProcessResult> {
      // 1. MANDATORY Stage 7 gate for THIS family. Throws => zero writers ran.
      await deps.verifyStage7(args.familyId)

      // 2. Explicit, expiring, family-scoped trusted-server authority. Nothing
      //    below can write outside this family, and nothing outside this async
      //    scope inherits the authority.
      const context: TrustedV4WriteContext = {
        trustedServer: true,
        writer: 'task_approval',
        route: 'v4',
        familyId: args.familyId,
        gate: { passed: true, verifiedAt: now() },
      }

      return runWithTrustedV4Write(context, async () => {
        const facts = await loadFacts(deps.db, args)
        if (facts === null) return { status: 'ignored', reason: 'completion_not_approved' }
        if (facts.familyId !== args.familyId) {
          throw new TaskApprovalFactsError('facts familyId does not match the approval family')
        }

        const result = await applyTaskApprovalV4(deps.db, facts)
        return {
          status: result.status === 'duplicate' ? 'duplicate' : 'processed',
          logicalCompletionKey: result.eventId,
        }
      })
    },
  }
}
