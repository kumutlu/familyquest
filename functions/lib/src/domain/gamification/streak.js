"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareCodeUnits = compareCodeUnits;
exports.assertCausalGroupInvariants = assertCausalGroupInvariants;
exports.calculateStreak = calculateStreak;
const dailyProgress_1 = require("./dailyProgress");
const types_1 = require("./types");
/** Compares canonical identifiers by UTF-16 code units without locale collation. */
function compareCodeUnits(left, right) {
    if (left === right)
        return 0;
    return left < right ? -1 : 1;
}
function compareNumbers(left, right) {
    if (left === right)
        return 0;
    return left < right ? -1 : 1;
}
/** A causal group is an atomic fact and cannot span children, families, or authoritative times. */
function assertCausalGroupInvariants(records) {
    const metadataByGroup = new Map();
    for (const record of records) {
        const existing = metadataByGroup.get(record.causalGroupId);
        if (existing === undefined) {
            metadataByGroup.set(record.causalGroupId, record);
            continue;
        }
        if (existing.effectiveAt !== record.effectiveAt) {
            throw new Error(`Causal group ${record.causalGroupId} has inconsistent effectiveAt`);
        }
        if (existing.familyId !== record.familyId) {
            throw new Error(`Causal group ${record.causalGroupId} has inconsistent familyId`);
        }
        if (existing.childId !== record.childId) {
            throw new Error(`Causal group ${record.causalGroupId} has inconsistent childId`);
        }
    }
}
function compareRecords(left, right) {
    return compareNumbers(left.effectiveAt, right.effectiveAt)
        || compareCodeUnits(left.causalGroupId, right.causalGroupId)
        || compareNumbers(left.transitionRank, right.transitionRank)
        || compareCodeUnits(left.id, right.id);
}
function eventRecords(events) {
    const seenIds = new Set();
    const records = [];
    for (const { id, event } of events) {
        if (seenIds.has(id))
            continue;
        seenIds.add(id);
        records.push({
            id, causalGroupId: event.causalGroupId, effectiveAt: event.effectiveAt,
            familyId: event.familyId, childId: event.childId, transitionRank: event.transitionRank, event,
        });
    }
    return records;
}
function eligibilityRecords(snapshots) {
    const seenDays = new Set();
    const records = [];
    for (const snapshot of snapshots) {
        if (seenDays.has(snapshot.dayKey))
            continue;
        seenDays.add(snapshot.dayKey);
        records.push({
            id: `daily_eligibility:${snapshot.familyId}:${snapshot.childId}:${snapshot.dayKey}`,
            causalGroupId: snapshot.causalGroupId,
            effectiveAt: snapshot.effectiveAt,
            familyId: snapshot.familyId,
            childId: snapshot.childId,
            transitionRank: snapshot.transitionRank,
        });
    }
    return records;
}
function qualificationStateAfterReplay(snapshots, qualificationByDay) {
    const orderedSnapshots = [...snapshots]
        .filter((snapshot, index, all) => all.findIndex((candidate) => candidate.dayKey === snapshot.dayKey) === index)
        .sort((left, right) => compareCodeUnits(left.dayKey, right.dayKey));
    let currentStreak = 0;
    let lastQualifiedDayKey = null;
    let previousDayKey = null;
    let unresolvedEligibleDay = false;
    for (const snapshot of orderedSnapshots) {
        const hasCalendarGap = previousDayKey !== null && (0, dailyProgress_1.addFamilyDays)(previousDayKey, 1) !== snapshot.dayKey;
        if (hasCalendarGap)
            unresolvedEligibleDay = true;
        if (snapshot.eligiblePoints === 0) {
            previousDayKey = snapshot.dayKey;
            continue;
        }
        const state = qualificationByDay.get(snapshot.dayKey);
        if (state === 'qualified') {
            currentStreak = currentStreak > 0 && !unresolvedEligibleDay ? currentStreak + 1 : 1;
            lastQualifiedDayKey = snapshot.dayKey;
            unresolvedEligibleDay = false;
        }
        else if (state === 'unqualified') {
            currentStreak = 0;
            lastQualifiedDayKey = null;
            unresolvedEligibleDay = false;
        }
        else {
            // No immutable transition is an unfinalized/unknown day, never a clock-derived miss.
            unresolvedEligibleDay = true;
        }
        previousDayKey = snapshot.dayKey;
    }
    return { currentStreak, lastQualifiedDayKey };
}
/**
 * Rebuilds streaks solely from immutable eligibility and qualification events.
 * Qualification effects are observed only once every record in their causal
 * group has been applied, preventing transient same-group streak gains.
 */
function calculateStreak(input) {
    const snapshots = input.eligibilitySnapshots;
    const records = [...eligibilityRecords(snapshots), ...eventRecords(input.events)];
    assertCausalGroupInvariants(records);
    records.sort(compareRecords);
    const qualificationByDay = new Map();
    let bestStreak = 0;
    for (let start = 0; start < records.length;) {
        let end = start + 1;
        while (end < records.length && records[end].causalGroupId === records[start].causalGroupId)
            end += 1;
        (0, types_1.assertCausalGroupRecordCount)(end - start);
        for (const record of records.slice(start, end)) {
            const event = record.event;
            if (event?.eventType !== 'daily_goal_qualification_changed' || event.dayKey === undefined || event.qualificationState === undefined)
                continue;
            qualificationByDay.set(event.dayKey, event.qualificationState);
        }
        const observed = qualificationStateAfterReplay(snapshots, qualificationByDay);
        bestStreak = Math.max(bestStreak, observed.currentStreak);
        start = end;
    }
    const current = qualificationStateAfterReplay(snapshots, qualificationByDay);
    return { ...current, bestStreak };
}
//# sourceMappingURL=streak.js.map