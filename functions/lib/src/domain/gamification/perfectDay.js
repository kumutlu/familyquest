"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dailyGoalEventId = dailyGoalEventId;
exports.dailyGoalRevocationEventId = dailyGoalRevocationEventId;
exports.perfectDayEventId = perfectDayEventId;
exports.perfectDayRevocationEventId = perfectDayRevocationEventId;
exports.dailyGoalQualificationEventId = dailyGoalQualificationEventId;
exports.perfectDayQualificationEventId = perfectDayQualificationEventId;
exports.planThresholdEvents = planThresholdEvents;
exports.calculatePerfectDayCount = calculatePerfectDayCount;
const config_1 = require("./config");
const types_1 = require("./types");
const streak_1 = require("./streak");
const transitionRanks = {
    daily_goal_awarded: 0,
    daily_goal_revoked: 1,
    daily_goal_qualification_changed: 2,
    perfect_day_awarded: 3,
    perfect_day_revoked: 4,
    perfect_day_qualification_changed: 5,
};
function assertComponent(value, label) {
    if (value.length === 0 || value.includes('/'))
        throw new Error(`${label} must be non-empty and may not contain /`);
}
function encodeComponent(value, label) {
    assertComponent(value, label);
    return encodeURIComponent(value);
}
function assertEpochMilliseconds(value) {
    if (!Number.isSafeInteger(value) || value < 0)
        throw new Error('effectiveAt must be a non-negative safe integer epoch millisecond value');
}
function dailyGoalEventId(familyId, childId, dayKey) {
    return `daily_goal:${encodeComponent(familyId, 'familyId')}:${encodeComponent(childId, 'childId')}:${encodeComponent(dayKey, 'dayKey')}`;
}
function dailyGoalRevocationEventId(familyId, childId, dayKey) {
    return `daily_goal_reversal:${encodeComponent(familyId, 'familyId')}:${encodeComponent(childId, 'childId')}:${encodeComponent(dayKey, 'dayKey')}`;
}
function perfectDayEventId(familyId, childId, dayKey) {
    return `perfect_day:${encodeComponent(familyId, 'familyId')}:${encodeComponent(childId, 'childId')}:${encodeComponent(dayKey, 'dayKey')}`;
}
function perfectDayRevocationEventId(familyId, childId, dayKey) {
    return `perfect_day_reversal:${encodeComponent(familyId, 'familyId')}:${encodeComponent(childId, 'childId')}:${encodeComponent(dayKey, 'dayKey')}`;
}
function qualificationEventId(threshold, familyId, childId, dayKey, sourceTransitionId) {
    assertComponent(sourceTransitionId, 'sourceTransitionId');
    return `${threshold}_qualification:${encodeComponent(familyId, 'familyId')}:${encodeComponent(childId, 'childId')}:${encodeComponent(dayKey, 'dayKey')}:${sourceTransitionId}`;
}
function dailyGoalQualificationEventId(familyId, childId, dayKey, sourceTransitionId) {
    return qualificationEventId('daily_goal', familyId, childId, dayKey, sourceTransitionId);
}
function perfectDayQualificationEventId(familyId, childId, dayKey, sourceTransitionId) {
    return qualificationEventId('perfect_day', familyId, childId, dayKey, sourceTransitionId);
}
function compareEvents(left, right) {
    if (left.event.effectiveAt !== right.event.effectiveAt)
        return left.event.effectiveAt < right.event.effectiveAt ? -1 : 1;
    const groupOrder = (0, streak_1.compareCodeUnits)(left.event.causalGroupId, right.event.causalGroupId);
    if (groupOrder !== 0)
        return groupOrder;
    if (left.event.transitionRank !== right.event.transitionRank)
        return left.event.transitionRank < right.event.transitionRank ? -1 : 1;
    return (0, streak_1.compareCodeUnits)(left.id, right.id);
}
function uniqueEvents(events) {
    const seenIds = new Set();
    return events.filter(({ id }) => !seenIds.has(id) && (seenIds.add(id), true));
}
function qualificationByThreshold(events, threshold, dayKey) {
    const unique = uniqueEvents(events);
    (0, streak_1.assertCausalGroupInvariants)(unique.map(({ id, event }) => ({
        id, causalGroupId: event.causalGroupId, effectiveAt: event.effectiveAt, familyId: event.familyId, childId: event.childId,
    })));
    unique.sort(compareEvents);
    let state;
    for (let start = 0; start < unique.length;) {
        let end = start + 1;
        while (end < unique.length && unique[end].event.causalGroupId === unique[start].event.causalGroupId)
            end += 1;
        (0, types_1.assertCausalGroupRecordCount)(end - start);
        for (const { event } of unique.slice(start, end)) {
            if (event.eventType === `${threshold}_qualification_changed` && event.dayKey === dayKey && event.qualificationState !== undefined) {
                state = event.qualificationState;
            }
        }
        start = end;
    }
    return state;
}
function eventWasEverPlanned(events, id) {
    return events.some((document) => document.id === id);
}
function event(id, progress, sourceTransitionId, effectiveAt, eventType, xpDelta, transitionRank, qualificationState, causalEventId) {
    return {
        id,
        event: {
            schemaVersion: 1,
            familyId: progress.familyId,
            childId: progress.childId,
            eventType,
            xpDelta,
            sourceType: 'daily_progress',
            sourceId: sourceTransitionId,
            idempotencyKey: id,
            dayKey: progress.dayKey,
            timezone: progress.timezone,
            causalEventId,
            causalGroupId: (0, types_1.causalGroupIdForTransition)(sourceTransitionId),
            effectiveAt,
            transitionRank,
            configSchemaVersion: 1,
            createdBy: 'gamification-engine-v1',
            createdAt: effectiveAt,
            sourceTransitionId,
            qualificationState,
        },
    };
}
function planForThreshold(threshold, reached, input) {
    const { progress, sourceTransitionId, effectiveAt, existingEvents } = input;
    const familyId = progress.familyId;
    const childId = progress.childId;
    const dayKey = progress.dayKey;
    const awardId = threshold === 'daily_goal'
        ? dailyGoalEventId(familyId, childId, dayKey)
        : perfectDayEventId(familyId, childId, dayKey);
    const revocationId = threshold === 'daily_goal'
        ? dailyGoalRevocationEventId(familyId, childId, dayKey)
        : perfectDayRevocationEventId(familyId, childId, dayKey);
    const qualificationId = qualificationEventId(threshold, familyId, childId, dayKey, sourceTransitionId);
    const priorQualification = qualificationByThreshold(existingEvents, threshold, dayKey);
    const qualificationType = `${threshold}_qualification_changed`;
    const events = [];
    if (reached) {
        if (!eventWasEverPlanned(existingEvents, awardId)) {
            events.push(event(awardId, progress, sourceTransitionId, effectiveAt, `${threshold}_awarded`, threshold === 'daily_goal' ? config_1.GAMIFICATION_CONFIG_V1.dailyGoalBonusXp : config_1.GAMIFICATION_CONFIG_V1.perfectDayBonusXp, transitionRanks[`${threshold}_awarded`]));
        }
        if (priorQualification !== 'qualified' && !eventWasEverPlanned(existingEvents, qualificationId)) {
            events.push(event(qualificationId, progress, sourceTransitionId, effectiveAt, qualificationType, 0, transitionRanks[qualificationType], 'qualified'));
        }
        return events;
    }
    // Only immutable finalization may make an otherwise-missing eligible day unqualified.
    if (!progress.finalized)
        return events;
    if (eventWasEverPlanned(existingEvents, awardId) && !eventWasEverPlanned(existingEvents, revocationId)) {
        events.push(event(revocationId, progress, sourceTransitionId, effectiveAt, `${threshold}_revoked`, threshold === 'daily_goal' ? -config_1.GAMIFICATION_CONFIG_V1.dailyGoalBonusXp : -config_1.GAMIFICATION_CONFIG_V1.perfectDayBonusXp, transitionRanks[`${threshold}_revoked`], undefined, awardId));
    }
    if (priorQualification !== 'unqualified' && !eventWasEverPlanned(existingEvents, qualificationId)) {
        events.push(event(qualificationId, progress, sourceTransitionId, effectiveAt, qualificationType, 0, transitionRanks[qualificationType], 'unqualified'));
    }
    return events;
}
/** Plans immutable threshold awards, compensations, and qualification transitions for one source transition. */
function planThresholdEvents(input) {
    const { progress, sourceTransitionId, effectiveAt } = input;
    assertComponent(sourceTransitionId, 'sourceTransitionId');
    assertEpochMilliseconds(effectiveAt);
    if (progress.eligiblePoints === 0)
        return [];
    return [
        ...planForThreshold('daily_goal', progress.dailyGoalReached, input),
        ...planForThreshold('perfect_day', progress.perfectDayReached, input),
    ].sort(compareEvents);
}
/** Replays the latest Perfect Day qualification for each immutable local day. */
function calculatePerfectDayCount(events) {
    const unique = uniqueEvents(events);
    (0, streak_1.assertCausalGroupInvariants)(unique.map(({ id, event }) => ({
        id, causalGroupId: event.causalGroupId, effectiveAt: event.effectiveAt, familyId: event.familyId, childId: event.childId,
    })));
    unique.sort(compareEvents);
    const qualificationByDay = new Map();
    for (let start = 0; start < unique.length;) {
        let end = start + 1;
        while (end < unique.length && unique[end].event.causalGroupId === unique[start].event.causalGroupId)
            end += 1;
        (0, types_1.assertCausalGroupRecordCount)(end - start);
        for (const { event } of unique.slice(start, end)) {
            if (event.eventType === 'perfect_day_qualification_changed' && event.dayKey !== undefined && event.qualificationState !== undefined) {
                qualificationByDay.set(event.dayKey, event.qualificationState);
            }
        }
        start = end;
    }
    return [...qualificationByDay.values()].filter((state) => state === 'qualified').length;
}
//# sourceMappingURL=perfectDay.js.map