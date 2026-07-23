export interface ProcessApprovedCompletionArgs {
  readonly familyId: string
  readonly completionId: string
  readonly processingAt: number
}

export interface ProcessTaskInvalidationArgs extends ProcessApprovedCompletionArgs {
  readonly immutableReversalId?: string
}

export interface GamificationProcessResult {
  readonly status: 'processed' | 'duplicate' | 'ignored'
  readonly logicalCompletionKey?: string
}

export interface GamificationProcessorRepository {
  processApprovedCompletion(args: ProcessApprovedCompletionArgs): Promise<GamificationProcessResult>
  processTaskInvalidation(args: ProcessTaskInvalidationArgs): Promise<GamificationProcessResult>
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

export async function processApprovedCompletion(
  dependencies: GamificationProcessorDependencies,
  args: Omit<ProcessApprovedCompletionArgs, 'processingAt'>,
): Promise<GamificationProcessResult> {
  assertId(args.familyId, 'familyId')
  assertId(args.completionId, 'completionId')
  return dependencies.repository.processApprovedCompletion({ ...args, processingAt: processingAt(dependencies) })
}

export async function processTaskInvalidation(
  dependencies: GamificationProcessorDependencies,
  args: Omit<ProcessTaskInvalidationArgs, 'processingAt'>,
): Promise<GamificationProcessResult> {
  assertId(args.familyId, 'familyId')
  assertId(args.completionId, 'completionId')
  if (args.immutableReversalId !== undefined) assertId(args.immutableReversalId, 'immutableReversalId')
  return dependencies.repository.processTaskInvalidation({ ...args, processingAt: processingAt(dependencies) })
}
