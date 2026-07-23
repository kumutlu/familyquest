"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logicalCompletionKey = logicalCompletionKey;
exports.taskXpEventId = taskXpEventId;
exports.taskXpReversalEventId = taskXpReversalEventId;
exports.legacyBaselineEventId = legacyBaselineEventId;
exports.foldXpEvents = foldXpEvents;
function assertComponent(value, label) {
    if (value.length === 0 || value.includes('/') || value.includes('|')) {
        throw new Error(`${label} must be non-empty and may not contain / or |`);
    }
}
function assertLogicalCompletionKey(value) {
    const components = value.split('|');
    if (components.length !== 4 || components[0] !== 'task_v1') {
        throw new Error('logicalCompletionKey must use the task_v1 canonical form');
    }
    for (const component of components.slice(1))
        assertComponent(component, 'logicalCompletionKey component');
}
function logicalCompletionKey(childId, taskId, periodKey) {
    assertComponent(childId, 'childId');
    assertComponent(taskId, 'taskId');
    assertComponent(periodKey, 'periodKey');
    return `task_v1|${childId}|${taskId}|${periodKey}`;
}
function taskXpEventId(key) {
    assertLogicalCompletionKey(key);
    return `task_xp:${key}`;
}
function taskXpReversalEventId(key) {
    assertLogicalCompletionKey(key);
    return `task_xp_reversal:${key}`;
}
function legacyBaselineEventId(familyId, childId) {
    assertComponent(familyId, 'familyId');
    assertComponent(childId, 'childId');
    return `legacy_xp_baseline:${encodeURIComponent(familyId)}:${encodeURIComponent(childId)}`;
}
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(',')}]`;
    if (value !== null && typeof value === 'object') {
        const entries = Object.entries(value)
            .filter(([, entryValue]) => entryValue !== undefined)
            .sort(([left], [right]) => left.localeCompare(right));
        return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
function canonicalSnapshot(event) {
    const { sourceId: _sourceId, createdAt: _createdAt, migratedAt: _migratedAt, ...semanticEvent } = event;
    return canonicalJson(semanticEvent);
}
function assertEventDelta(event) {
    if (!Number.isSafeInteger(event.xpDelta)) {
        throw new Error('XP event delta must be a safe integer');
    }
}
/**
 * Replays immutable XP events. Logical retries with distinct completion document
 * IDs collapse only when every accounting field in their snapshots agrees.
 */
function foldXpEvents(documents) {
    const documentIds = new Set();
    const snapshotsByIdempotencyKey = new Map();
    let xpTotal = 0n;
    for (const { id, event } of documents) {
        if (id.length === 0)
            throw new Error('XP event document ID must be non-empty');
        if (documentIds.has(id))
            throw new Error(`Duplicate XP event document ID: ${id}`);
        documentIds.add(id);
        assertEventDelta(event);
        const snapshot = canonicalSnapshot(event);
        const existingSnapshot = snapshotsByIdempotencyKey.get(event.idempotencyKey);
        if (existingSnapshot !== undefined) {
            if (existingSnapshot !== snapshot) {
                throw new Error(`XP event integrity error: conflicting snapshot for ${event.idempotencyKey}`);
            }
            continue;
        }
        snapshotsByIdempotencyKey.set(event.idempotencyKey, snapshot);
        xpTotal += BigInt(event.xpDelta);
    }
    if (xpTotal < 0n)
        throw new Error('XP ledger must not be negative');
    if (xpTotal > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('XP ledger total exceeds safe integer range');
    }
    return Number(xpTotal);
}
//# sourceMappingURL=xp.js.map