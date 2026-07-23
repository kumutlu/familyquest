"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_CAUSAL_GROUP_RECORDS = void 0;
exports.assertCausalGroupRecordCount = assertCausalGroupRecordCount;
exports.approvalSourceTransitionId = approvalSourceTransitionId;
exports.invalidationSourceTransitionId = invalidationSourceTransitionId;
exports.cancellationSourceTransitionId = cancellationSourceTransitionId;
exports.finalizationSourceTransitionId = finalizationSourceTransitionId;
exports.causalGroupIdForTransition = causalGroupIdForTransition;
exports.MAX_CAUSAL_GROUP_RECORDS = 8;
function assertCausalGroupRecordCount(recordCount) {
    if (!Number.isInteger(recordCount) || recordCount < 0 || recordCount > exports.MAX_CAUSAL_GROUP_RECORDS) {
        throw new Error(`A causal group may contain at most ${exports.MAX_CAUSAL_GROUP_RECORDS} records`);
    }
}
function assertComponent(value, label) {
    if (value.length === 0 || value.includes('/') || value.includes('|')) {
        throw new Error(`${label} must be non-empty and may not contain / or |`);
    }
}
function assertEpochMilliseconds(value) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error('Timestamp must be a non-negative safe integer epoch millisecond value');
    }
}
function assertLogicalCompletionKey(value) {
    const parts = value.split('|');
    if (parts.length !== 4 || parts[0] !== 'task_v1') {
        throw new Error('logicalCompletionKey must use the task_v1 canonical form');
    }
    for (const component of parts.slice(1))
        assertComponent(component, 'logicalCompletionKey component');
}
function approvalSourceTransitionId(logicalCompletionKey) {
    assertLogicalCompletionKey(logicalCompletionKey);
    return `approval_v1|${logicalCompletionKey}`;
}
function invalidationSourceTransitionId(immutableReversalId) {
    assertComponent(immutableReversalId, 'immutableReversalId');
    return `invalidation_v1|${immutableReversalId}`;
}
function cancellationSourceTransitionId(completionId, authoritativeStatusChangedAt) {
    assertComponent(completionId, 'completionId');
    assertEpochMilliseconds(authoritativeStatusChangedAt);
    return `cancellation_v1|${completionId}|${authoritativeStatusChangedAt}`;
}
function finalizationSourceTransitionId(eligibilitySnapshotId) {
    assertComponent(eligibilitySnapshotId, 'eligibilitySnapshotId');
    return `finalization_v1|${eligibilitySnapshotId}`;
}
function causalGroupIdForTransition(sourceTransitionId) {
    if (sourceTransitionId.length === 0)
        throw new Error('sourceTransitionId must be non-empty');
    return `gamification_transition_v1|${sourceTransitionId}`;
}
//# sourceMappingURL=types.js.map