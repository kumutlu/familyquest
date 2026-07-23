import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore'
import { processApprovedCompletion, processTaskInvalidation, type GamificationProcessorDependencies } from './gamificationProcessor'

interface CompletionState { readonly status?: unknown }

export interface CompletionWrittenInput {
  readonly familyId: string
  readonly completionId: string
  readonly before?: CompletionState
  readonly after?: CompletionState
}

export interface CompletionTriggerActions {
  readonly approved: (args: { familyId: string; completionId: string }) => Promise<unknown>
  readonly invalidated: (args: { familyId: string; completionId: string; immutableReversalId?: string }) => Promise<unknown>
}

export async function handleTaskCompletionWritten(actions: CompletionTriggerActions, input: CompletionWrittenInput): Promise<void> {
  const beforeStatus = input.before?.status
  const afterStatus = input.after?.status
  if (afterStatus === 'approved' && beforeStatus !== 'approved') {
    await actions.approved({ familyId: input.familyId, completionId: input.completionId })
    return
  }
  if (beforeStatus === 'approved' && (afterStatus === 'cancelled' || afterStatus === 'invalidated')) {
    await actions.invalidated({ familyId: input.familyId, completionId: input.completionId })
  }
}

export interface ReversalCreatedInput {
  readonly familyId: string
  readonly reversalId: string
  readonly data?: Record<string, unknown>
}

export async function handleGamificationReversalCreated(
  actions: Pick<CompletionTriggerActions, 'invalidated'>,
  input: ReversalCreatedInput,
): Promise<void> {
  if (input.data?.sourceKind !== 'task_completion' || typeof input.data.sourceId !== 'string') return
  await actions.invalidated({
    familyId: input.familyId,
    completionId: input.data.sourceId,
    immutableReversalId: input.reversalId,
  })
}

export function createGamificationTriggers(dependencies: GamificationProcessorDependencies) {
  const actions: CompletionTriggerActions = {
    approved: args => processApprovedCompletion(dependencies, args),
    invalidated: args => processTaskInvalidation(dependencies, args),
  }
  return {
    onTaskCompletionWritten: onDocumentWritten('families/{familyId}/task_completions/{completionId}', async event => {
      await handleTaskCompletionWritten(actions, {
        familyId: event.params.familyId,
        completionId: event.params.completionId,
        before: event.data?.before.exists ? event.data.before.data() : undefined,
        after: event.data?.after.exists ? event.data.after.data() : undefined,
      })
    }),
    onGamificationReversalCreated: onDocumentCreated('families/{familyId}/reversals/{reversalId}', async event => {
      await handleGamificationReversalCreated(actions, {
        familyId: event.params.familyId,
        reversalId: event.params.reversalId,
        data: event.data?.data(),
      })
    }),
  }
}
