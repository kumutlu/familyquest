"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processApprovedCompletion = processApprovedCompletion;
exports.processTaskInvalidation = processTaskInvalidation;
function assertId(value, label) {
    if (value.length === 0 || value.includes('/'))
        throw new Error(`${label} must be a non-empty Firestore document ID`);
}
function processingAt(dependencies) {
    const value = dependencies.now();
    if (!Number.isSafeInteger(value) || value < 0)
        throw new Error('now must return non-negative epoch milliseconds');
    return value;
}
async function processApprovedCompletion(dependencies, args) {
    assertId(args.familyId, 'familyId');
    assertId(args.completionId, 'completionId');
    return dependencies.repository.processApprovedCompletion({ ...args, processingAt: processingAt(dependencies) });
}
async function processTaskInvalidation(dependencies, args) {
    assertId(args.familyId, 'familyId');
    assertId(args.completionId, 'completionId');
    if (args.immutableReversalId !== undefined)
        assertId(args.immutableReversalId, 'immutableReversalId');
    return dependencies.repository.processTaskInvalidation({ ...args, processingAt: processingAt(dependencies) });
}
//# sourceMappingURL=gamificationProcessor.js.map