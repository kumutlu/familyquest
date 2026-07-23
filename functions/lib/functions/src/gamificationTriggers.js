"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleTaskCompletionWritten = handleTaskCompletionWritten;
exports.handleGamificationReversalCreated = handleGamificationReversalCreated;
exports.createGamificationTriggers = createGamificationTriggers;
const firestore_1 = require("firebase-functions/v2/firestore");
const gamificationProcessor_1 = require("./gamificationProcessor");
async function handleTaskCompletionWritten(actions, input) {
    const beforeStatus = input.before?.status;
    const afterStatus = input.after?.status;
    if (afterStatus === 'approved' && beforeStatus !== 'approved') {
        await actions.approved({ familyId: input.familyId, completionId: input.completionId });
        return;
    }
    if (beforeStatus === 'approved' && (afterStatus === 'cancelled' || afterStatus === 'invalidated')) {
        await actions.invalidated({ familyId: input.familyId, completionId: input.completionId });
    }
}
async function handleGamificationReversalCreated(actions, input) {
    if (input.data?.sourceKind !== 'task_completion' || typeof input.data.sourceId !== 'string')
        return;
    await actions.invalidated({
        familyId: input.familyId,
        completionId: input.data.sourceId,
        immutableReversalId: input.reversalId,
    });
}
function createGamificationTriggers(dependencies) {
    const actions = {
        approved: args => (0, gamificationProcessor_1.processApprovedCompletion)(dependencies, args),
        invalidated: args => (0, gamificationProcessor_1.processTaskInvalidation)(dependencies, args),
    };
    return {
        onTaskCompletionWritten: (0, firestore_1.onDocumentWritten)('families/{familyId}/task_completions/{completionId}', async (event) => {
            await handleTaskCompletionWritten(actions, {
                familyId: event.params.familyId,
                completionId: event.params.completionId,
                before: event.data?.before.exists ? event.data.before.data() : undefined,
                after: event.data?.after.exists ? event.data.after.data() : undefined,
            });
        }),
        onGamificationReversalCreated: (0, firestore_1.onDocumentCreated)('families/{familyId}/reversals/{reversalId}', async (event) => {
            await handleGamificationReversalCreated(actions, {
                familyId: event.params.familyId,
                reversalId: event.params.reversalId,
                data: event.data?.data(),
            });
        }),
    };
}
//# sourceMappingURL=gamificationTriggers.js.map