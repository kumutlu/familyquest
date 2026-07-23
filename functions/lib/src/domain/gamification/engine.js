"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planApprovedTask = planApprovedTask;
exports.planTaskReversal = planTaskReversal;
exports.rebuildGamificationSummary = rebuildGamificationSummary;
const config_1 = require("./config");
const dailyProgress_1 = require("./dailyProgress");
const perfectDay_1 = require("./perfectDay");
const streak_1 = require("./streak");
const types_1 = require("./types");
const level_1 = require("./level");
const xp_1 = require("./xp");
function assertString(value, label) {
    if (typeof value !== 'string' || value.length === 0)
        throw new Error(`${label} must be non-empty`);
}
function assertEpoch(value, label) {
    if (!Number.isSafeInteger(value) || value < 0)
        throw new Error(`${label} must be a non-negative safe integer epoch millisecond value`);
}
function assertNonNegativeSafeInteger(value, label) {
    if (!Number.isSafeInteger(value) || value < 0)
        throw new Error(`${label} must be a non-negative safe integer`);
}
function assertLogicalKey(value, label) {
    const parts = value.split('|');
    if (parts.length !== 4 || parts[0] !== 'task_v1')
        throw new Error(`${label} must use task_v1 canonical form`);
    for (const part of parts.slice(1)) {
        if (part.length === 0 || part.includes('/') || part.includes('|'))
            throw new Error(`${label} has an invalid component`);
    }
}
function assertEffect(effect) {
    if (effect.schemaVersion !== 1)
        throw new Error('immutable effect has an unsupported schema version');
    assertString(effect.familyId, 'immutable effect familyId');
    assertString(effect.childId, 'immutable effect childId');
    assertString(effect.taskId, 'immutable effect taskId');
    assertString(effect.periodKey, 'immutable effect periodKey');
    assertString(effect.dayKey, 'immutable effect dayKey');
    assertString(effect.timezone, 'immutable effect timezone');
    assertLogicalKey(effect.logicalCompletionKey, 'immutable effect logicalCompletionKey');
    if (effect.logicalCompletionKey !== (0, xp_1.logicalCompletionKey)(effect.childId, effect.taskId, effect.periodKey)) {
        throw new Error('immutable effect logicalCompletionKey does not match its child/task/period identity');
    }
    assertNonNegativeSafeInteger(effect.pointsReward, 'immutable effect pointsReward');
    assertNonNegativeSafeInteger(effect.xpAward, 'immutable effect xpAward');
    assertNonNegativeSafeInteger(effect.rewardPointsAward, 'immutable effect rewardPointsAward');
    assertNonNegativeSafeInteger(effect.dailyWeight, 'immutable effect dailyWeight');
    assertEpoch(effect.approvedAt, 'immutable effect approvedAt');
    if (typeof effect.requiresApproval !== 'boolean')
        throw new Error('immutable effect requiresApproval must be boolean');
    if (effect.pointsReward !== effect.xpAward || effect.pointsReward !== effect.rewardPointsAward) {
        throw new Error('immutable effect reward, XP, and reward-point snapshots must agree');
    }
}
function assertEligibility(snapshot) {
    if (snapshot.schemaVersion !== 1)
        throw new Error('eligibility snapshot has an unsupported schema version');
    assertString(snapshot.familyId, 'eligibility snapshot familyId');
    assertString(snapshot.childId, 'eligibility snapshot childId');
    assertString(snapshot.dayKey, 'eligibility snapshot dayKey');
    assertString(snapshot.timezone, 'eligibility snapshot timezone');
    assertEpoch(snapshot.effectiveAt, 'eligibility snapshot effectiveAt');
    assertEpoch(snapshot.createdAt, 'eligibility snapshot createdAt');
    if (!Number.isInteger(snapshot.dailyGoalPercentage) || snapshot.dailyGoalPercentage < 50 || snapshot.dailyGoalPercentage > 100) {
        throw new Error('eligibility snapshot has an invalid daily goal percentage');
    }
    let total = 0n;
    for (const [taskId, weight] of Object.entries(snapshot.taskWeights)) {
        assertString(taskId, 'eligibility snapshot task ID');
        assertNonNegativeSafeInteger(weight, 'eligibility snapshot task weight');
        total += BigInt(weight);
    }
    if (total > BigInt(Number.MAX_SAFE_INTEGER) || snapshot.eligiblePoints !== Number(total)
        || snapshot.eligibleTaskCount !== Object.keys(snapshot.taskWeights).length) {
        throw new Error('eligibility snapshot aggregate fields do not match frozen weights');
    }
}
function assertEventDocument(document) {
    assertString(document.id, 'event document ID');
    const event = document.event;
    if (event.schemaVersion !== 1)
        throw new Error('event has an unsupported schema version');
    assertString(event.familyId, 'event familyId');
    assertString(event.childId, 'event childId');
    assertString(event.idempotencyKey, 'event idempotencyKey');
    assertString(event.causalGroupId, 'event causalGroupId');
    assertEpoch(event.effectiveAt, 'event effectiveAt');
    assertEpoch(event.createdAt, 'event createdAt');
    if (!Number.isSafeInteger(event.xpDelta))
        throw new Error('event xpDelta must be a safe integer');
    if (!Number.isInteger(event.transitionRank))
        throw new Error('event transitionRank must be an integer');
}
function eventSemanticSnapshot(event) {
    const { createdAt: _createdAt, migratedAt: _migratedAt, ...semanticEvent } = event;
    const entries = Object.entries(semanticEvent).filter(([, value]) => value !== undefined).sort(([a], [b]) => (0, streak_1.compareCodeUnits)(a, b));
    return JSON.stringify(entries);
}
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(',')}]`;
    if (value !== null && typeof value === 'object') {
        return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => (0, streak_1.compareCodeUnits)(left, right))
            .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
function uniqueEligibilitySnapshots(snapshots) {
    const byIdentity = new Map();
    for (const snapshot of snapshots) {
        assertEligibility(snapshot);
        const identity = `${snapshot.familyId}\u0000${snapshot.childId}\u0000${snapshot.dayKey}`;
        const prior = byIdentity.get(identity);
        if (prior !== undefined && canonicalJson(prior) !== canonicalJson(snapshot)) {
            throw new Error(`Conflicting immutable snapshot for ${snapshot.familyId}/${snapshot.childId}/${snapshot.dayKey}`);
        }
        if (prior === undefined)
            byIdentity.set(identity, snapshot);
    }
    return [...byIdentity.values()];
}
function documentsById(events) {
    const byId = new Map();
    for (const document of events) {
        assertEventDocument(document);
        const existing = byId.get(document.id);
        if (existing !== undefined && eventSemanticSnapshot(existing.event) !== eventSemanticSnapshot(document.event)) {
            throw new Error(`Event integrity error: conflicting immutable event ${document.id}`);
        }
        if (existing === undefined)
            byId.set(document.id, document);
    }
    return byId;
}
function assertSharedInput(input) {
    assertString(input.completionId, 'completionId');
    assertEpoch(input.processingAt, 'processingAt');
    assertString(input.eligibilitySnapshotId, 'eligibilitySnapshotId');
    assertEffect(input.effect);
    assertEligibility(input.eligibilitySnapshot);
    if (input.effect.familyId !== input.eligibilitySnapshot.familyId || input.effect.childId !== input.eligibilitySnapshot.childId
        || input.effect.dayKey !== input.eligibilitySnapshot.dayKey || input.effect.timezone !== input.eligibilitySnapshot.timezone) {
        throw new Error('immutable effect does not match the authoritative eligibility snapshot');
    }
    for (const key of input.invalidatedLogicalCompletionKeys)
        assertLogicalKey(key, 'invalidated logical completion key');
    for (const completionEffect of input.completionEffects) {
        assertString(completionEffect.completionId, 'completion effect completionId');
        if (!['pending_approval', 'approved', 'rejected', 'cancelled', 'invalidated'].includes(completionEffect.status)) {
            throw new Error('completion effect status must be a supported task completion status');
        }
        assertEffect(completionEffect.effect);
        if (completionEffect.effect.familyId !== input.effect.familyId || completionEffect.effect.childId !== input.effect.childId) {
            throw new Error('completion effect does not match the plan family/child');
        }
    }
    documentsById(input.existingEvents);
    for (const snapshot of input.existingEligibilitySnapshots ?? [])
        assertEligibility(snapshot);
}
function taskAward(effect, sourceTransitionId, causalGroupId, effectiveAt) {
    const id = (0, xp_1.taskXpEventId)(effect.logicalCompletionKey);
    return {
        id,
        event: {
            schemaVersion: 1, familyId: effect.familyId, childId: effect.childId, eventType: 'xp_awarded', xpDelta: effect.xpAward,
            sourceType: 'task_completion', sourceId: effect.logicalCompletionKey, logicalCompletionKey: effect.logicalCompletionKey,
            idempotencyKey: id, causalGroupId, effectiveAt, transitionRank: 0, taskId: effect.taskId,
            configSchemaVersion: 1, createdBy: 'gamification-engine-v1', createdAt: effectiveAt, sourceTransitionId,
        },
    };
}
function taskRevocation(effect, sourceTransitionId, causalGroupId, effectiveAt) {
    const id = (0, xp_1.taskXpReversalEventId)(effect.logicalCompletionKey);
    return {
        id,
        event: {
            schemaVersion: 1, familyId: effect.familyId, childId: effect.childId, eventType: 'xp_revoked', xpDelta: -effect.xpAward,
            sourceType: 'task_completion', sourceId: sourceTransitionId, logicalCompletionKey: effect.logicalCompletionKey,
            idempotencyKey: id, causalEventId: (0, xp_1.taskXpEventId)(effect.logicalCompletionKey), causalGroupId, effectiveAt, transitionRank: 1,
            taskId: effect.taskId, configSchemaVersion: 1, createdBy: 'gamification-engine-v1', createdAt: effectiveAt, sourceTransitionId,
        },
    };
}
function qualificationEvent(kind, state, effect, sourceTransitionId, causalGroupId, effectiveAt, transitionRank) {
    const id = kind === 'daily_goal'
        ? (0, perfectDay_1.dailyGoalQualificationEventId)(effect.familyId, effect.childId, effect.dayKey, sourceTransitionId)
        : (0, perfectDay_1.perfectDayQualificationEventId)(effect.familyId, effect.childId, effect.dayKey, sourceTransitionId);
    return {
        id,
        event: {
            schemaVersion: 1, familyId: effect.familyId, childId: effect.childId, eventType: `${kind}_qualification_changed`, xpDelta: 0,
            sourceType: 'daily_progress', sourceId: sourceTransitionId, idempotencyKey: id, dayKey: effect.dayKey, timezone: effect.timezone,
            causalGroupId, effectiveAt, transitionRank, configSchemaVersion: 1, createdBy: 'gamification-engine-v1', createdAt: effectiveAt,
            sourceTransitionId, qualificationState: state,
        },
    };
}
function atomicRepairEvents(effect) {
    const approvalTransition = (0, types_1.approvalSourceTransitionId)(effect.logicalCompletionKey);
    const approvalGroup = (0, types_1.causalGroupIdForTransition)(approvalTransition);
    const repairTransition = (0, types_1.invalidationSourceTransitionId)(`repair:${encodeURIComponent(effect.logicalCompletionKey)}`);
    const effectiveAt = effect.approvedAt;
    return [
        taskAward(effect, approvalTransition, approvalGroup, effectiveAt),
        taskRevocation(effect, repairTransition, approvalGroup, effectiveAt),
        qualificationEvent('daily_goal', 'qualified', effect, approvalTransition, approvalGroup, effectiveAt, 2),
        qualificationEvent('daily_goal', 'unqualified', effect, repairTransition, approvalGroup, effectiveAt, 3),
        qualificationEvent('perfect_day', 'qualified', effect, approvalTransition, approvalGroup, effectiveAt, 4),
        qualificationEvent('perfect_day', 'unqualified', effect, repairTransition, approvalGroup, effectiveAt, 5),
    ];
}
function progressFor(input) {
    return (0, dailyProgress_1.calculateDailyProgress)({
        eligibilitySnapshot: input.eligibilitySnapshot, eligibilitySnapshotId: input.eligibilitySnapshotId,
        completionEffects: input.completionEffects, invalidatedLogicalCompletionKeys: input.invalidatedLogicalCompletionKeys,
        finalized: input.finalized, calculatedAt: input.processingAt,
    });
}
function mergeSnapshots(input) {
    return uniqueEligibilitySnapshots([...(input.existingEligibilitySnapshots ?? []), input.eligibilitySnapshot]);
}
function planSummary(input, events) {
    return rebuildGamificationSummary({ events: [...input.existingEvents, ...events], eligibilitySnapshots: mergeSnapshots(input), processingAt: input.processingAt });
}
function onlyUnwritten(existing, planned) {
    for (const document of planned) {
        const prior = existing.get(document.id);
        if (prior !== undefined && eventSemanticSnapshot(prior.event) !== eventSemanticSnapshot(document.event)) {
            throw new Error(`Event integrity error: existing ${document.id} does not match the immutable write plan`);
        }
    }
    return planned.filter((document) => !existing.has(document.id));
}
function assertExpectedExisting(existing, expected) {
    const prior = existing.get(expected.id);
    if (prior !== undefined && eventSemanticSnapshot(prior.event) !== eventSemanticSnapshot(expected.event)) {
        throw new Error(`Event integrity error: existing ${expected.id} does not match its immutable semantic plan`);
    }
}
function assertRepairGroup(existing, causalGroupId, expected) {
    const expectedById = new Map(expected.map((document) => [document.id, document]));
    for (const document of existing.values()) {
        if (document.event.causalGroupId !== causalGroupId)
            continue;
        const expectedDocument = expectedById.get(document.id);
        if (expectedDocument === undefined) {
            throw new Error(`Event integrity error: unexpected immutable event ${document.id} in atomic repair group`);
        }
        if (eventSemanticSnapshot(document.event) !== eventSemanticSnapshot(expectedDocument.event)) {
            throw new Error(`Event integrity error: existing ${document.id} does not match the atomic repair group`);
        }
    }
}
function assertReusableTransitionEvent(document, expected) {
    const event = document.event;
    if (document.id !== event.idempotencyKey || event.eventType !== expected.eventType || event.xpDelta !== expected.xpDelta
        || event.sourceType !== expected.sourceType || event.logicalCompletionKey !== expected.logicalCompletionKey
        || event.dayKey !== expected.dayKey || event.timezone !== expected.timezone || event.causalEventId !== expected.causalEventId
        || event.transitionRank !== expected.transitionRank || event.taskId !== expected.taskId || event.configSchemaVersion !== 1
        || event.createdBy !== 'gamification-engine-v1' || event.sourceTransitionId === undefined || event.sourceId !== event.sourceTransitionId
        || event.causalGroupId !== (0, types_1.causalGroupIdForTransition)(event.sourceTransitionId)) {
        throw new Error(`Event integrity error: existing ${document.id} has invalid immutable accounting fields`);
    }
}
function assertReusableThresholdEvents(existing, progress) {
    const base = { logicalCompletionKey: undefined, dayKey: progress.dayKey, timezone: progress.timezone, taskId: undefined };
    const checks = [
        [(0, perfectDay_1.dailyGoalEventId)(progress.familyId, progress.childId, progress.dayKey), { ...base, eventType: 'daily_goal_awarded', xpDelta: config_1.GAMIFICATION_CONFIG_V1.dailyGoalBonusXp, sourceType: 'daily_progress', causalEventId: undefined, transitionRank: 0 }],
        [(0, perfectDay_1.dailyGoalRevocationEventId)(progress.familyId, progress.childId, progress.dayKey), { ...base, eventType: 'daily_goal_revoked', xpDelta: -config_1.GAMIFICATION_CONFIG_V1.dailyGoalBonusXp, sourceType: 'daily_progress', causalEventId: (0, perfectDay_1.dailyGoalEventId)(progress.familyId, progress.childId, progress.dayKey), transitionRank: 1 }],
        [(0, perfectDay_1.perfectDayEventId)(progress.familyId, progress.childId, progress.dayKey), { ...base, eventType: 'perfect_day_awarded', xpDelta: config_1.GAMIFICATION_CONFIG_V1.perfectDayBonusXp, sourceType: 'daily_progress', causalEventId: undefined, transitionRank: 3 }],
        [(0, perfectDay_1.perfectDayRevocationEventId)(progress.familyId, progress.childId, progress.dayKey), { ...base, eventType: 'perfect_day_revoked', xpDelta: -config_1.GAMIFICATION_CONFIG_V1.perfectDayBonusXp, sourceType: 'daily_progress', causalEventId: (0, perfectDay_1.perfectDayEventId)(progress.familyId, progress.childId, progress.dayKey), transitionRank: 4 }],
    ];
    for (const [id, expected] of checks) {
        const document = existing.get(id);
        if (document !== undefined)
            assertReusableTransitionEvent(document, expected);
    }
    for (const document of existing.values()) {
        if ((document.event.eventType === 'daily_goal_qualification_changed' || document.event.eventType === 'perfect_day_qualification_changed')
            && document.event.dayKey === progress.dayKey) {
            const rank = document.event.eventType === 'daily_goal_qualification_changed' ? 2 : 5;
            assertReusableTransitionEvent(document, { ...base, eventType: document.event.eventType, xpDelta: 0,
                sourceType: 'daily_progress', causalEventId: undefined, transitionRank: rank });
            if (document.event.qualificationState !== 'qualified' && document.event.qualificationState !== 'unqualified') {
                throw new Error(`Event integrity error: existing ${document.id} has an invalid qualification state`);
            }
        }
    }
}
/** Plans one approved occurrence using frozen facts only; manual and auto paths deliberately share it. */
function planApprovedTask(input) {
    assertSharedInput(input);
    const existing = documentsById(input.existingEvents);
    const approvalTransition = (0, types_1.approvalSourceTransitionId)(input.effect.logicalCompletionKey);
    const approvalGroup = (0, types_1.causalGroupIdForTransition)(approvalTransition);
    const effectiveAt = input.effect.approvedAt;
    const expectedAward = taskAward(input.effect, approvalTransition, approvalGroup, effectiveAt);
    assertExpectedExisting(existing, expectedAward);
    const invalidated = input.invalidatedLogicalCompletionKeys.includes(input.effect.logicalCompletionKey);
    if (invalidated) {
        const planned = atomicRepairEvents(input.effect);
        assertRepairGroup(existing, approvalGroup, planned);
        const events = onlyUnwritten(existing, planned);
        const progress = progressFor(input);
        return Object.freeze({ events: Object.freeze(events), progress, summary: planSummary(input, events) });
    }
    const progress = progressFor(input);
    assertReusableThresholdEvents(existing, progress);
    const existingAward = existing.has((0, xp_1.taskXpEventId)(input.effect.logicalCompletionKey));
    if (input.qualificationSourceTransitionId !== undefined && !existingAward) {
        throw new Error('a qualification recovery source requires an existing immutable task award');
    }
    if (input.qualificationSourceTransitionId !== undefined)
        assertString(input.qualificationSourceTransitionId, 'qualificationSourceTransitionId');
    const thresholdTransition = input.qualificationSourceTransitionId ?? approvalTransition;
    const thresholdEffectiveAt = input.qualificationSourceTransitionId === undefined ? effectiveAt : input.processingAt;
    const planned = [
        ...(existingAward ? [] : [expectedAward]),
        ...(0, perfectDay_1.planThresholdEvents)({ progress, sourceTransitionId: thresholdTransition, effectiveAt: thresholdEffectiveAt, existingEvents: input.existingEvents }),
    ];
    const events = onlyUnwritten(existing, planned);
    return Object.freeze({ events: Object.freeze(events), progress, summary: planSummary(input, events) });
}
/** Plans a compensation only when its immutable award is already present. */
function planTaskReversal(input) {
    assertSharedInput(input);
    const existing = documentsById(input.existingEvents);
    const reversalTransition = input.immutableReversalId !== undefined
        ? (0, types_1.invalidationSourceTransitionId)(input.immutableReversalId)
        : (0, types_1.cancellationSourceTransitionId)(input.completionId, input.authoritativeStatusChangedAt ?? input.processingAt);
    const awardId = (0, xp_1.taskXpEventId)(input.effect.logicalCompletionKey);
    const reversalId = (0, xp_1.taskXpReversalEventId)(input.effect.logicalCompletionKey);
    const progress = progressFor(input);
    if (!existing.has(awardId)) {
        return Object.freeze({ events: Object.freeze([]), progress, summary: planSummary(input, []) });
    }
    assertExpectedExisting(existing, taskAward(input.effect, (0, types_1.approvalSourceTransitionId)(input.effect.logicalCompletionKey), (0, types_1.causalGroupIdForTransition)((0, types_1.approvalSourceTransitionId)(input.effect.logicalCompletionKey)), input.effect.approvedAt));
    const existingReversal = existing.get(reversalId);
    const repair = atomicRepairEvents(input.effect);
    const repairReversal = repair.find((document) => document.id === reversalId);
    if (existingReversal !== undefined && repairReversal !== undefined
        && existingReversal.event.sourceTransitionId === repairReversal.event.sourceTransitionId
        && existingReversal.event.causalGroupId === repairReversal.event.causalGroupId) {
        assertRepairGroup(existing, repairReversal.event.causalGroupId, repair);
        const events = onlyUnwritten(existing, repair);
        return Object.freeze({ events: Object.freeze(events), progress, summary: planSummary(input, events) });
    }
    if (existingReversal !== undefined) {
        assertReusableTransitionEvent(existingReversal, {
            eventType: 'xp_revoked', xpDelta: -input.effect.xpAward, sourceType: 'task_completion',
            logicalCompletionKey: input.effect.logicalCompletionKey, dayKey: undefined, timezone: undefined,
            causalEventId: awardId, transitionRank: 1, taskId: input.effect.taskId,
        });
    }
    assertReusableThresholdEvents(existing, progress);
    const group = (0, types_1.causalGroupIdForTransition)(reversalTransition);
    // A reversal removes a previously observed qualification even before finalization;
    // finalization only creates misses where no compensation fact exists.
    const compensationProgress = progress.finalized ? progress : { ...progress, finalized: true };
    const planned = [
        ...(existing.has(reversalId) ? [] : [taskRevocation(input.effect, reversalTransition, group, input.processingAt)]),
        ...(0, perfectDay_1.planThresholdEvents)({ progress: compensationProgress, sourceTransitionId: reversalTransition, effectiveAt: input.processingAt, existingEvents: input.existingEvents }),
    ];
    const events = onlyUnwritten(existing, planned);
    return Object.freeze({ events: Object.freeze(events), progress, summary: planSummary(input, events) });
}
function cursorForEvent(document) {
    return { effectiveAt: document.event.effectiveAt, causalGroupId: document.event.causalGroupId, transitionRank: document.event.transitionRank, documentId: document.id };
}
function cursorForSnapshot(snapshot) {
    return {
        effectiveAt: snapshot.effectiveAt, causalGroupId: snapshot.causalGroupId, transitionRank: snapshot.transitionRank,
        documentId: `daily_eligibility:${snapshot.familyId}:${snapshot.childId}:${snapshot.dayKey}`,
    };
}
function compareCursor(left, right) {
    if (left.effectiveAt !== right.effectiveAt)
        return left.effectiveAt < right.effectiveAt ? -1 : 1;
    const group = (0, streak_1.compareCodeUnits)(left.causalGroupId, right.causalGroupId);
    if (group !== 0)
        return group;
    if (left.transitionRank !== right.transitionRank)
        return left.transitionRank < right.transitionRank ? -1 : 1;
    return (0, streak_1.compareCodeUnits)(left.documentId, right.documentId);
}
/** Rebuilds the cache entirely from immutable events and eligibility facts. */
function rebuildGamificationSummary(input) {
    assertEpoch(input.processingAt, 'processingAt');
    const eligibilitySnapshots = uniqueEligibilitySnapshots(input.eligibilitySnapshots);
    const familyIds = new Set();
    const childIds = new Set();
    for (const document of input.events) {
        assertEventDocument(document);
        familyIds.add(document.event.familyId);
        childIds.add(document.event.childId);
    }
    for (const snapshot of eligibilitySnapshots) {
        familyIds.add(snapshot.familyId);
        childIds.add(snapshot.childId);
    }
    if (familyIds.size !== 1 || childIds.size !== 1)
        throw new Error('Summary rebuild requires immutable facts for exactly one family and child');
    const events = [...documentsById(input.events).values()];
    const xpTotal = (0, xp_1.foldXpEvents)(events);
    const streak = (0, streak_1.calculateStreak)({ eligibilitySnapshots, events });
    const cursors = [...events.map(cursorForEvent), ...eligibilitySnapshots.map(cursorForSnapshot)].sort(compareCursor);
    return Object.freeze({
        schemaVersion: 1, familyId: [...familyIds][0], childId: [...childIds][0], xpTotal,
        level: (0, level_1.levelForXp)(xpTotal, config_1.GAMIFICATION_CONFIG_V1.xpPerLevel), currentStreak: streak.currentStreak,
        bestStreak: streak.bestStreak, perfectDayCount: (0, perfectDay_1.calculatePerfectDayCount)(events), lastQualifiedDayKey: streak.lastQualifiedDayKey,
        projectionRevision: 0, foldedThrough: cursors.at(-1) ?? null, rebuildRequired: false, earliestDirtyCursor: null,
        projectionStatus: 'ready', updatedAt: input.processingAt,
    });
}
//# sourceMappingURL=engine.js.map