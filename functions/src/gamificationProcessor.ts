export const GAMIFICATION_PROCESSOR_VERSION = 'gamification-processor-v2-shared-tasks'

import { requireLegacyRoute } from './gamification/routingShim'

export interface ProcessApprovedCompletionArgs {
  readonly familyId: string
  readonly completionId: string
  readonly processingAt: number
}

export interface ProcessTaskInvalidationArgs extends ProcessApprovedCompletionArgs {
  readonly immutableReversalId?: string
}

export interface GamificationProcessResult {
  readonly status: 'processed' | 'duplicate' | 'ignored' | 'failed'
  readonly logicalCompletionKey?: string
  readonly reason?: string
}

/**
 * A validation failure that will never succeed on retry (wrong family, wrong
 * assignee, inactive child, malformed reward). These are written to the
 * processor dead-letter collection and swallowed so Cloud Functions does not
 * retry them forever. Every other error stays retryable.
 */
export class DeterministicProcessorFailure extends Error {
  constructor(
    readonly reason: string,
    readonly context: { readonly childId?: string; readonly taskId?: string } = {},
  ) {
    super(`Deterministic gamification failure: ${reason}`)
    this.name = 'DeterministicProcessorFailure'
  }
}

export interface ProcessorFailureRecord {
  readonly familyId: string
  readonly completionId: string
  readonly childId?: string
  readonly taskId?: string
  readonly reason: string
  readonly failedAt: number
  readonly processorVersion: string
}

export interface GamificationProcessorRepository {
  processApprovedCompletion(args: ProcessApprovedCompletionArgs): Promise<GamificationProcessResult>
  processTaskInvalidation(args: ProcessTaskInvalidationArgs): Promise<GamificationProcessResult>
  recordProcessorFailure(record: ProcessorFailureRecord): Promise<void>
}

export interface GamificationProcessorDependencies {
  readonly repository: GamificationProcessorRepository
  readonly now: () => number
}

function assertId(value: string, label: string): void {
  if (value.length === 0 || value.includes('/')) throw new Error(`${label} must be a non-empty Firestore document ID`)
}

function processingAt(dependencies: GamificationProcessorDependencies): number {
  const value = dependencies.now()
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('now must return non-negative epoch milliseconds')
  return value
}

async function runWithDeadLettering(
  dependencies: GamificationProcessorDependencies,
  identity: { readonly familyId: string; readonly completionId: string; readonly failedAt: number },
  run: () => Promise<GamificationProcessResult>,
): Promise<GamificationProcessResult> {
  try {
    return await run()
  } catch (error) {
    if (!(error instanceof DeterministicProcessorFailure)) throw error
    await dependencies.repository.recordProcessorFailure({
      familyId: identity.familyId,
      completionId: identity.completionId,
      ...(error.context.childId !== undefined ? { childId: error.context.childId } : {}),
      ...(error.context.taskId !== undefined ? { taskId: error.context.taskId } : {}),
      reason: error.reason,
      failedAt: identity.failedAt,
      processorVersion: GAMIFICATION_PROCESSOR_VERSION,
    })
    return { status: 'failed', reason: error.reason }
  }
}

export async function processApprovedCompletion(
  dependencies: GamificationProcessorDependencies,
  args: Omit<ProcessApprovedCompletionArgs, 'processingAt'>,
): Promise<GamificationProcessResult> {
  // Stage 7 pre-cutover routing: single authoritative route, fail-closed.
  await requireLegacyRoute('task_approval', args.familyId)
  assertId(args.familyId, 'familyId')
  assertId(args.completionId, 'completionId')
  const at = processingAt(dependencies)
  return runWithDeadLettering(dependencies, { ...args, failedAt: at }, () =>
    dependencies.repository.processApprovedCompletion({ ...args, processingAt: at }))
}

export async function processTaskInvalidation(
  dependencies: GamificationProcessorDependencies,
  args: Omit<ProcessTaskInvalidationArgs, 'processingAt'>,
): Promise<GamificationProcessResult> {
  // Stage 7 pre-cutover routing: single authoritative route, fail-closed.
  await requireLegacyRoute('task_invalidation', args.familyId)
  assertId(args.familyId, 'familyId')
  assertId(args.completionId, 'completionId')
  if (args.immutableReversalId !== undefined) assertId(args.immutableReversalId, 'immutableReversalId')
  const at = processingAt(dependencies)
  return runWithDeadLettering(dependencies, { familyId: args.familyId, completionId: args.completionId, failedAt: at }, () =>
    dependencies.repository.processTaskInvalidation({ ...args, processingAt: at }))
}
