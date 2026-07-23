"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminGamificationRepository = void 0;
const config_1 = require("../../src/domain/gamification/config");
const dailyProgress_1 = require("../../src/domain/gamification/dailyProgress");
const engine_1 = require("../../src/domain/gamification/engine");
const level_1 = require("../../src/domain/gamification/level");
const perfectDay_1 = require("../../src/domain/gamification/perfectDay");
const types_1 = require("../../src/domain/gamification/types");
const xp_1 = require("../../src/domain/gamification/xp");
const dailyEligibilityAdapter_1 = require("./dailyEligibilityAdapter");
const gamificationRepair_1 = require("./gamificationRepair");
const APPROVED_STATUSES = ['prepared', 'baseline_complete', 'active'];
const REBUILD_STREAM_LIMIT = 125;
function millis(value, label) {
    if (value instanceof Date && Number.isSafeInteger(value.getTime()) && value.getTime() >= 0)
        return value.getTime();
    if (value !== null && typeof value === 'object' && typeof value.toMillis === 'function') {
        const result = value.toMillis();
        if (Number.isSafeInteger(result) && result >= 0)
            return result;
    }
    throw new Error(`${label} must be an Admin Timestamp`);
}
function optionalMillis(value, label) {
    return value === undefined || value === null ? undefined : millis(value, label);
}
function timestamp(value) {
    if (!Number.isSafeInteger(value) || value < 0)
        throw new Error('timestamp must be non-negative epoch milliseconds');
    return new Date(value);
}
function migrationState(family) {
    const value = family.gamificationMigration;
    if (value === null || typeof value !== 'object' || value.schemaVersion !== 1
        || !['inactive', 'prepared', 'baseline_complete', 'active'].includes(value.status)) {
        return { status: 'inactive' };
    }
    return {
        status: value.status,
        cutoverAt: optionalMillis(value.cutoverAt, 'gamificationMigration.cutoverAt'),
        repairCheckpoint: typeof value.repairCheckpoint === 'string' ? value.repairCheckpoint : undefined,
        repairBoundaryAt: optionalMillis(value.repairBoundaryAt, 'gamificationMigration.repairBoundaryAt'),
    };
}
function timezoneOf(family) {
    const value = family.timezone;
    if (typeof value !== 'string' || value.length === 0)
        return 'Europe/London';
    try {
        new Intl.DateTimeFormat('en-CA', { timeZone: value }).format(0);
        return value;
    }
    catch {
        return 'Europe/London';
    }
}
function dateParts(dayKey) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
    if (match === null)
        throw new Error('dayKey must use YYYY-MM-DD');
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}
/** First instant whose formatted family-local date is dayKey. */
function localDayStart(dayKey, timezone) {
    const [year, month, day] = dateParts(dayKey);
    const utcNoon = Date.UTC(year, month - 1, day, 12);
    let low = utcNoon - 36 * 60 * 60 * 1000;
    let high = utcNoon + 36 * 60 * 60 * 1000;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if ((0, dailyProgress_1.familyDayKey)(middle, timezone) < dayKey)
            low = middle + 1;
        else
            high = middle;
    }
    if ((0, dailyProgress_1.familyDayKey)(low, timezone) !== dayKey)
        throw new Error(`Unable to resolve local day start for ${dayKey}`);
    return low;
}
function taskFromDocument(document) {
    const data = document.data() ?? {};
    return {
        id: document.id,
        assigneeId: typeof data.assigneeId === 'string' ? data.assigneeId : undefined,
        pointsReward: data.pointsReward,
        requiresApproval: typeof data.requiresApproval === 'boolean' ? data.requiresApproval : undefined,
        type: typeof data.type === 'string' ? data.type : undefined,
        isActive: data.isActive === true,
        status: typeof data.status === 'string' ? data.status : undefined,
        archived: data.archived === true,
        isArchived: data.isArchived === true,
        deleted: data.deleted === true,
        disabled: data.disabled === true,
        archivedAt: optionalMillis(data.archivedAt, `task ${document.id} archivedAt`),
        deletedAt: optionalMillis(data.deletedAt, `task ${document.id} deletedAt`),
        disabledAt: optionalMillis(data.disabledAt, `task ${document.id} disabledAt`),
        createdAt: optionalMillis(data.createdAt, `task ${document.id} createdAt`),
        effectiveFrom: typeof data.effectiveFrom === 'string' ? data.effectiveFrom : undefined,
        effectiveTo: typeof data.effectiveTo === 'string' ? data.effectiveTo : undefined,
        effectiveFromAt: typeof data.effectiveFrom === 'string' ? undefined : optionalMillis(data.effectiveFrom, `task ${document.id} effectiveFrom`),
        effectiveToAt: typeof data.effectiveTo === 'string' ? undefined : optionalMillis(data.effectiveTo, `task ${document.id} effectiveTo`),
        dueDate: typeof data.dueDate === 'string' ? data.dueDate : undefined,
        dueWeekday: Number.isInteger(data.dueWeekday) ? data.dueWeekday : undefined,
        customDays: Array.isArray(data.customDays) ? data.customDays : undefined,
    };
}
function effectFromData(data) {
    const effect = data;
    return {
        schemaVersion: 1,
        familyId: String(effect.familyId),
        childId: String(effect.childId),
        taskId: String(effect.taskId),
        logicalCompletionKey: String(effect.logicalCompletionKey),
        periodKey: String(effect.periodKey),
        dayKey: String(effect.dayKey),
        timezone: String(effect.timezone),
        pointsReward: Number(effect.pointsReward),
        xpAward: Number(effect.xpAward),
        rewardPointsAward: Number(effect.rewardPointsAward),
        dailyWeight: Number(effect.dailyWeight),
        requiresApproval: effect.requiresApproval === true,
        approvedAt: millis(effect.approvedAt, 'gamificationEffectSnapshot.approvedAt'),
    };
}
function effectToData(effect) {
    return { ...effect, approvedAt: timestamp(effect.approvedAt) };
}
function eligibilityFromData(data) {
    return {
        schemaVersion: 1,
        familyId: data.familyId,
        childId: data.childId,
        dayKey: data.dayKey,
        timezone: data.timezone,
        dailyGoalPercentage: data.dailyGoalPercentage,
        taskWeights: data.taskWeights ?? {},
        eligibleTaskCount: data.eligibleTaskCount,
        eligiblePoints: data.eligiblePoints,
        effectiveAt: millis(data.effectiveAt, 'daily eligibility effectiveAt'),
        causalGroupId: data.causalGroupId,
        transitionRank: 0,
        createdAt: millis(data.createdAt, 'daily eligibility createdAt'),
        createdBy: 'gamification-engine-v1',
    };
}
function eligibilityToData(snapshot) {
    return { ...snapshot, effectiveAt: timestamp(snapshot.effectiveAt), createdAt: timestamp(snapshot.createdAt) };
}
function eventFromDocument(document) {
    const data = document.data();
    const event = {
        ...data,
        effectiveAt: millis(data.effectiveAt, `event ${document.id} effectiveAt`),
        createdAt: millis(data.createdAt, `event ${document.id} createdAt`),
        ...(data.migratedAt !== undefined ? { migratedAt: millis(data.migratedAt, `event ${document.id} migratedAt`) } : {}),
    };
    return { id: document.id, event };
}
function eventToData(event) {
    return withoutUndefined({
        ...event,
        effectiveAt: timestamp(event.effectiveAt),
        createdAt: timestamp(event.createdAt),
        ...(event.migratedAt !== undefined ? { migratedAt: timestamp(event.migratedAt) } : {}),
    });
}
function withoutUndefined(value) {
    if (Array.isArray(value))
        return value.map(withoutUndefined);
    if (value !== null && typeof value === 'object' && !(value instanceof Date)
        && typeof value.toMillis !== 'function') {
        return Object.fromEntries(Object.entries(value)
            .filter(([, entry]) => entry !== undefined)
            .map(([key, entry]) => [key, withoutUndefined(entry)]));
    }
    return value;
}
function cursorFromData(value) {
    if (value === null || value === undefined || typeof value !== 'object')
        return null;
    const data = value;
    return {
        effectiveAt: millis(data.effectiveAt, 'summary cursor effectiveAt'),
        causalGroupId: data.causalGroupId,
        transitionRank: data.transitionRank,
        documentId: data.documentId,
    };
}
function cursorToData(value) {
    return value === null ? null : { ...value, effectiveAt: timestamp(value.effectiveAt) };
}
function progressFromData(data) {
    return { ...data, calculatedAt: millis(data.calculatedAt, 'daily progress calculatedAt') };
}
function progressToData(progress, events = []) {
    const latest = (eventType) => [...events]
        .filter(document => document.event.eventType === eventType && document.event.dayKey === progress.dayKey)
        .sort((left, right) => compareCursor(cursorForEvent(left), cursorForEvent(right))).at(-1);
    const dailyGoalQualification = latest('daily_goal_qualification_changed');
    const perfectDayQualification = latest('perfect_day_qualification_changed');
    return withoutUndefined({
        ...progress,
        calculatedAt: timestamp(progress.calculatedAt),
        ...(dailyGoalQualification === undefined ? {} : {
            latestDailyGoalQualification: { id: dailyGoalQualification.id, event: eventToData(dailyGoalQualification.event) },
        }),
        ...(perfectDayQualification === undefined ? {} : {
            latestPerfectDayQualification: { id: perfectDayQualification.id, event: eventToData(perfectDayQualification.event) },
        }),
    });
}
function qualificationEventsFromProgress(data) {
    if (data === undefined)
        return [];
    const result = [];
    for (const field of ['latestDailyGoalQualification', 'latestPerfectDayQualification']) {
        const value = data[field];
        if (value !== null && typeof value === 'object' && typeof value.id === 'string' && value.event !== undefined) {
            result.push({ id: value.id, event: eventFromData(value.event) });
        }
    }
    return result;
}
function thresholdEventIds(familyId, childId, dayKey) {
    return [
        (0, perfectDay_1.dailyGoalEventId)(familyId, childId, dayKey),
        (0, perfectDay_1.dailyGoalRevocationEventId)(familyId, childId, dayKey),
        (0, perfectDay_1.perfectDayEventId)(familyId, childId, dayKey),
        (0, perfectDay_1.perfectDayRevocationEventId)(familyId, childId, dayKey),
    ];
}
function summaryFromData(data) {
    return {
        ...data,
        foldedThrough: cursorFromData(data.foldedThrough),
        earliestDirtyCursor: cursorFromData(data.earliestDirtyCursor),
        updatedAt: millis(data.updatedAt, 'summary updatedAt'),
    };
}
function summaryToData(summary) {
    return {
        ...summary,
        foldedThrough: cursorToData(summary.foldedThrough),
        earliestDirtyCursor: cursorToData(summary.earliestDirtyCursor),
        updatedAt: timestamp(summary.updatedAt),
    };
}
function compareCursor(left, right) {
    return left.effectiveAt - right.effectiveAt
        || (left.causalGroupId < right.causalGroupId ? -1 : left.causalGroupId > right.causalGroupId ? 1 : 0)
        || left.transitionRank - right.transitionRank
        || (left.documentId < right.documentId ? -1 : left.documentId > right.documentId ? 1 : 0);
}
function cursorForEvent(document) {
    return { effectiveAt: document.event.effectiveAt, causalGroupId: document.event.causalGroupId, transitionRank: document.event.transitionRank, documentId: document.id };
}
function earliestCursor(cursors) {
    return cursors.length === 0 ? null : [...cursors].sort(compareCursor)[0];
}
function latestCursor(cursors) {
    return cursors.length === 0 ? null : [...cursors].sort(compareCursor).at(-1);
}
function syntheticEffects(progress, snapshot) {
    if (progress === undefined)
        return [];
    return progress.contributingLogicalCompletionKeys.map(key => {
        const [, childId, taskId, periodKey] = key.split('|');
        const weight = snapshot.taskWeights[taskId];
        return {
            schemaVersion: 1, familyId: snapshot.familyId, childId, taskId, logicalCompletionKey: key, periodKey,
            dayKey: snapshot.dayKey, timezone: snapshot.timezone, pointsReward: weight, xpAward: weight,
            rewardPointsAward: weight, dailyWeight: weight, requiresApproval: true, approvedAt: 0,
        };
    });
}
function eventMap(documents) {
    const byId = new Map();
    for (const document of documents)
        byId.set(document.id, document);
    return [...byId.values()];
}
function defaultSummary(familyId, childId, processingAt) {
    return {
        schemaVersion: 1, familyId, childId, xpTotal: 0, level: 1, currentStreak: 0, bestStreak: 0,
        perfectDayCount: 0, lastQualifiedDayKey: null, projectionRevision: 0, foldedThrough: null,
        rebuildRequired: false, earliestDirtyCursor: null, projectionStatus: 'ready', updatedAt: processingAt,
    };
}
function projectSummary(current, familyId, childId, newEvents, progress, processingAt, additionalAuthorityCursors = []) {
    const base = current ?? defaultSummary(familyId, childId, processingAt);
    const eventCursors = newEvents.map(cursorForEvent);
    const cursors = [...eventCursors, ...additionalAuthorityCursors];
    const first = earliestCursor(cursors);
    const last = latestCursor(cursors);
    const historical = first !== null && base.foldedThrough !== null && compareCursor(first, base.foldedThrough) <= 0;
    const affectsHistoricalDay = newEvents.some(document => document.event.eventType.endsWith('_qualification_changed')
        && base.lastQualifiedDayKey !== null
        && document.event.dayKey !== undefined
        && document.event.dayKey < base.lastQualifiedDayKey);
    const existingDirty = base.rebuildRequired || base.earliestDirtyCursor !== null;
    const dirtyCursor = earliestCursor([
        ...(base.earliestDirtyCursor === null ? [] : [base.earliestDirtyCursor]),
        ...(historical && first !== null ? [first] : []),
        ...(affectsHistoricalDay && first !== null ? [first] : []),
    ]);
    const xpDelta = newEvents.reduce((total, document) => total + document.event.xpDelta, 0);
    const nextXp = base.xpTotal + xpDelta;
    if (!Number.isSafeInteger(nextXp) || nextXp < 0)
        throw new Error('Gamification summary XP would become invalid');
    const perfectTransitions = newEvents.filter(document => document.event.eventType === 'perfect_day_qualification_changed');
    const perfectDelta = perfectTransitions.reduce((delta, document) => delta + (document.event.qualificationState === 'qualified' ? 1 : -1), 0);
    const dailyTransitions = newEvents.filter(document => document.event.eventType === 'daily_goal_qualification_changed');
    const latestDaily = dailyTransitions.at(-1)?.event.qualificationState;
    let currentStreak = base.currentStreak;
    let lastQualifiedDayKey = base.lastQualifiedDayKey;
    if (!affectsHistoricalDay && latestDaily === 'unqualified') {
        currentStreak = 0;
        lastQualifiedDayKey = null;
    }
    else if (!affectsHistoricalDay && latestDaily === 'qualified') {
        if (base.lastQualifiedDayKey !== progress.dayKey) {
            currentStreak = base.lastQualifiedDayKey !== null && (0, dailyProgress_1.addFamilyDays)(base.lastQualifiedDayKey, 1) === progress.dayKey
                ? base.currentStreak + 1 : 1;
        }
        lastQualifiedDayKey = progress.dayKey;
    }
    const dirty = existingDirty || historical || affectsHistoricalDay;
    return {
        ...base,
        xpTotal: nextXp,
        level: (0, level_1.levelForXp)(nextXp, 1000),
        currentStreak,
        bestStreak: Math.max(base.bestStreak, currentStreak),
        perfectDayCount: Math.max(0, base.perfectDayCount + perfectDelta),
        lastQualifiedDayKey,
        projectionRevision: base.projectionRevision + 1,
        foldedThrough: historical ? base.foldedThrough : (last ?? base.foldedThrough),
        rebuildRequired: dirty,
        earliestDirtyCursor: dirtyCursor,
        projectionStatus: dirty ? 'rebuilding' : 'ready',
        updatedAt: processingAt,
    };
}
function immutableReservationMatches(data, identity) {
    if (data.schemaVersion !== 1 || data.familyId !== identity.familyId || data.childId !== identity.childId
        || data.taskId !== identity.taskId || data.logicalCompletionKey !== identity.logicalCompletionKey
        || data.periodKey !== identity.periodKey || data.dayKey !== identity.dayKey
        || data.effectId !== (0, xp_1.taskXpEventId)(identity.logicalCompletionKey) || data.effectSnapshot === undefined)
        return false;
    try {
        const effect = effectFromData(data.effectSnapshot);
        return effect.familyId === identity.familyId && effect.childId === identity.childId && effect.taskId === identity.taskId
            && effect.logicalCompletionKey === identity.logicalCompletionKey && effect.periodKey === identity.periodKey && effect.dayKey === identity.dayKey
            && effect.pointsReward === effect.xpAward && effect.pointsReward === effect.rewardPointsAward;
    }
    catch {
        return false;
    }
}
function canonicalEffect(effect) {
    return JSON.stringify([
        effect.schemaVersion, effect.familyId, effect.childId, effect.taskId, effect.logicalCompletionKey,
        effect.periodKey, effect.dayKey, effect.timezone, effect.pointsReward, effect.xpAward,
        effect.rewardPointsAward, effect.dailyWeight, effect.requiresApproval, effect.approvedAt,
    ]);
}
function notificationId(key) { return `gamification_task_approved:${encodeURIComponent(key)}`; }
function feedId(key) { return `gamification_task_approved:${encodeURIComponent(key)}`; }
class AdminGamificationRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async processApprovedCompletion(args) {
        const familyRef = this.db.doc(`families/${args.familyId}`);
        const completionRef = familyRef.collection('task_completions').doc(args.completionId);
        return this.db.runTransaction(async (transaction) => {
            const [familyDocument, completionDocument] = await Promise.all([
                transaction.get(familyRef), transaction.get(completionRef),
            ]);
            if (!familyDocument.exists)
                throw new Error(`Family ${args.familyId} does not exist`);
            if (!completionDocument.exists)
                throw new Error(`Completion ${args.completionId} does not exist`);
            const family = familyDocument.data();
            const completion = completionDocument.data();
            if (completion.status !== 'approved')
                return { status: 'ignored' };
            const migration = migrationState(family);
            if (!APPROVED_STATUSES.includes(migration.status))
                return { status: 'ignored' };
            if (migration.cutoverAt === undefined)
                throw new Error('Prepared gamification migration requires cutoverAt');
            const approvedAt = millis(completion.approvedAt, 'completion approvedAt');
            if (approvedAt < migration.cutoverAt)
                return { status: 'ignored' };
            const childId = completion.assigneeId;
            const taskId = completion.taskId;
            if (typeof childId !== 'string' || typeof taskId !== 'string')
                throw new Error('Completion identity is invalid');
            const taskRef = familyRef.collection('tasks').doc(taskId);
            const childRef = this.db.doc(`users/${childId}`);
            const [taskDocument, childDocument] = await Promise.all([
                transaction.get(taskRef), transaction.get(childRef),
            ]);
            if (!taskDocument.exists)
                throw new Error(`Task ${taskId} does not exist`);
            if (!childDocument.exists)
                throw new Error(`Child ${childId} does not exist`);
            const child = childDocument.data();
            if (child.familyId !== args.familyId || child.role !== 'child' || child.status === 'deleted' || child.status === 'disabled' || child.disabled === true) {
                throw new Error('Completion child is not an active child in this family');
            }
            const completedAt = millis(completion.completedAt, 'completion completedAt');
            const timezone = timezoneOf(family);
            const dayKey = (0, dailyProgress_1.familyDayKey)(completedAt, timezone);
            const task = taskFromDocument(taskDocument);
            if (task.assigneeId !== childId)
                throw new Error('Completion task is not assigned to this child');
            if (typeof task.pointsReward !== 'number' || !Number.isSafeInteger(task.pointsReward) || task.pointsReward < 0) {
                throw new Error(`Task ${taskId} has an invalid reward`);
            }
            const periodKey = (0, dailyEligibilityAdapter_1.authoritativePeriodKey)(task, dayKey);
            const logicalKey = (0, xp_1.logicalCompletionKey)(childId, taskId, periodKey);
            const occurrenceRef = familyRef.collection('task_occurrences').doc(logicalKey);
            const eligibilityRef = familyRef.collection('daily_eligibility').doc(`${childId}:${dayKey}`);
            const progressRef = familyRef.collection('daily_progress').doc(`${childId}:${dayKey}`);
            const summaryRef = familyRef.collection('gamification_summaries').doc(childId);
            const checkpointRef = familyRef.collection('gamification_checkpoints').doc(childId);
            const reversalRef = familyRef.collection('reversals').doc(`task_completion__${args.completionId}`);
            const [occurrenceDocument, eligibilityDocument, progressDocument, summaryDocument, checkpointDocument, reversalDocument] = await Promise.all([
                transaction.get(occurrenceRef), transaction.get(eligibilityRef), transaction.get(progressRef), transaction.get(summaryRef),
                transaction.get(checkpointRef), transaction.get(reversalRef),
            ]);
            if (occurrenceDocument.exists) {
                if (!immutableReservationMatches(occurrenceDocument.data(), {
                    familyId: args.familyId, childId, taskId, logicalCompletionKey: logicalKey, periodKey, dayKey,
                }))
                    throw new Error(`Occurrence ${logicalKey} has conflicting immutable identity`);
                return { status: 'duplicate', logicalCompletionKey: logicalKey };
            }
            const tasksQuery = familyRef.collection('tasks').where('assigneeId', '==', childId);
            const tasks = await transaction.get(tasksQuery);
            const config = (0, config_1.resolveGamificationConfig)(family.gamification);
            const expectedSnapshot = (0, dailyEligibilityAdapter_1.buildDailyEligibilitySnapshot)({
                familyId: args.familyId, childId, dayKey, timezone, dailyGoalPercentage: config.dailyGoalPercentage,
                tasks: tasks.docs.map(taskFromDocument), effectiveAt: localDayStart(dayKey, timezone), createdAt: args.processingAt,
            });
            const snapshot = eligibilityDocument.exists ? eligibilityFromData(eligibilityDocument.data()) : expectedSnapshot;
            if (snapshot.familyId !== args.familyId || snapshot.childId !== childId || snapshot.dayKey !== dayKey || snapshot.timezone !== timezone
                || snapshot.eligibleTaskCount !== Object.keys(snapshot.taskWeights).length
                || snapshot.eligiblePoints !== Object.values(snapshot.taskWeights).reduce((sum, weight) => sum + weight, 0)) {
                throw new Error(`Daily eligibility ${eligibilityRef.id} has conflicting immutable content`);
            }
            const frozenWeight = snapshot.taskWeights[taskId];
            if (frozenWeight === undefined && task.pointsReward !== 0)
                throw new Error('Approved completion is not eligible in the immutable daily snapshot');
            const effect = {
                schemaVersion: 1, familyId: args.familyId, childId, taskId, logicalCompletionKey: logicalKey, periodKey, dayKey, timezone,
                pointsReward: task.pointsReward, xpAward: task.pointsReward, rewardPointsAward: task.pointsReward,
                dailyWeight: frozenWeight ?? 0, requiresApproval: task.requiresApproval === true, approvedAt,
            };
            if (completion.awardedPoints !== undefined && completion.awardedPoints !== effect.rewardPointsAward) {
                throw new Error('Existing completion awardedPoints conflicts with the trusted reward plan');
            }
            if (completion.gamificationEffectSnapshot !== undefined
                && canonicalEffect(effectFromData(completion.gamificationEffectSnapshot)) !== canonicalEffect(effect)) {
                throw new Error('Existing completion gamification effect conflicts with the immutable trusted plan');
            }
            const progress = progressDocument.exists ? progressFromData(progressDocument.data()) : undefined;
            const [taskAwardDocument, taskReversalDocument, ...thresholdDocuments] = await Promise.all([
                transaction.get(familyRef.collection('gamification_events').doc((0, xp_1.taskXpEventId)(logicalKey))),
                transaction.get(familyRef.collection('gamification_events').doc((0, xp_1.taskXpReversalEventId)(logicalKey))),
                ...thresholdEventIds(args.familyId, childId, dayKey)
                    .map(id => transaction.get(familyRef.collection('gamification_events').doc(id))),
            ]);
            const existingEvents = eventMap([
                ...qualificationEventsFromProgress(progressDocument.data()),
                ...(taskAwardDocument.exists ? [eventFromDocument(taskAwardDocument)] : []),
                ...(taskReversalDocument.exists ? [eventFromDocument(taskReversalDocument)] : []),
                ...thresholdDocuments.filter(document => document.exists).map(eventFromDocument),
            ]);
            const priorEffects = syntheticEffects(progress, snapshot);
            const invalidatedKeys = new Set(progress?.invalidatedLogicalCompletionKeys ?? []);
            if (reversalDocument.exists)
                invalidatedKeys.add(logicalKey);
            const plan = (0, engine_1.planApprovedTask)({
                completionId: args.completionId,
                effect,
                eligibilitySnapshot: snapshot,
                eligibilitySnapshotId: eligibilityRef.id,
                completionEffects: [...priorEffects.filter(prior => prior.logicalCompletionKey !== effect.logicalCompletionKey)
                        .map((prior, index) => ({ completionId: `trusted-prior-${index}`, status: 'approved', effect: prior })),
                    { completionId: args.completionId, status: 'approved', effect }],
                invalidatedLogicalCompletionKeys: [...invalidatedKeys],
                existingEvents,
                existingEligibilitySnapshots: [snapshot],
                finalized: progress?.finalized ?? false,
                processingAt: args.processingAt,
            });
            const summary = projectSummary(summaryDocument.exists ? summaryFromData(summaryDocument.data()) : undefined, args.familyId, childId, plan.events, plan.progress, args.processingAt, eligibilityDocument.exists ? [] : [{
                    effectiveAt: snapshot.effectiveAt, causalGroupId: snapshot.causalGroupId,
                    transitionRank: snapshot.transitionRank, documentId: eligibilityRef.id,
                }]);
            const alreadyInvalid = reversalDocument.exists;
            const currentPoints = child.rewardPoints ?? 0;
            if (!Number.isSafeInteger(currentPoints) || currentPoints < 0)
                throw new Error('Child rewardPoints is invalid');
            const nextPoints = alreadyInvalid ? currentPoints : currentPoints + effect.rewardPointsAward;
            if (!Number.isSafeInteger(nextPoints))
                throw new Error('Child rewardPoints would exceed the safe integer range');
            if (!eligibilityDocument.exists)
                transaction.create(eligibilityRef, eligibilityToData(snapshot));
            transaction.create(occurrenceRef, {
                schemaVersion: 1, familyId: args.familyId, childId, taskId, logicalCompletionKey: logicalKey, periodKey,
                completionId: args.completionId, dayKey, effectId: (0, xp_1.taskXpEventId)(logicalKey), effectSnapshot: effectToData(effect), createdAt: timestamp(args.processingAt),
            });
            transaction.update(completionRef, {
                awardedPoints: effect.rewardPointsAward,
                effectSnapshot: {
                    schemaVersion: 1, entityType: 'task_completion', familyId: args.familyId,
                    actorId: typeof completion.reviewedBy === 'string' ? completion.reviewedBy : childId,
                    childId, pointsDelta: effect.rewardPointsAward, xpAdjustment: 0,
                },
                gamificationEffectSnapshot: effectToData(effect),
                gamificationDayKey: dayKey,
                gamificationProcessedAt: timestamp(args.processingAt),
                ...(alreadyInvalid ? { gamificationRewardRevokedBy: reversalRef.id } : {}),
            });
            if (nextPoints !== currentPoints)
                transaction.update(childRef, { rewardPoints: nextPoints, lastTaskCompletionId: args.completionId });
            for (const document of plan.events)
                transaction.create(familyRef.collection('gamification_events').doc(document.id), eventToData(document.event));
            transaction.set(progressRef, progressToData(plan.progress, [...existingEvents, ...plan.events]));
            transaction.set(summaryRef, summaryToData(summary));
            if (checkpointDocument.exists && checkpointDocument.data().dirty !== true)
                transaction.update(checkpointRef, { dirty: true });
            transaction.create(familyRef.collection('feed').doc(feedId(logicalKey)), {
                actorId: typeof completion.reviewedBy === 'string' ? completion.reviewedBy : childId,
                type: 'custom', text: `Task approved: ${taskDocument.data().title ?? taskId} (+${effect.rewardPointsAward} pts)`,
                visibleTo: [childId], timestamp: timestamp(args.processingAt), entityType: 'task_completion', entityId: args.completionId,
            });
            transaction.create(familyRef.collection('notifications').doc(notificationId(logicalKey)), {
                familyId: args.familyId, type: 'task_approved', actorId: typeof completion.reviewedBy === 'string' ? completion.reviewedBy : childId,
                recipientIds: [childId], title: 'Task approved', body: `${taskDocument.data().title ?? 'Task'} was approved. +${effect.rewardPointsAward} points`,
                entityType: 'task_completion', entityId: args.completionId, actionUrl: '/tasks', dedupeKey: notificationId(logicalKey), createdAt: timestamp(args.processingAt),
            });
            return { status: 'processed', logicalCompletionKey: logicalKey };
        });
    }
    async processTaskInvalidation(args) {
        const familyRef = this.db.doc(`families/${args.familyId}`);
        const completionRef = familyRef.collection('task_completions').doc(args.completionId);
        return this.db.runTransaction(async (transaction) => {
            const [familyDocument, completionDocument] = await Promise.all([transaction.get(familyRef), transaction.get(completionRef)]);
            if (!familyDocument.exists || !completionDocument.exists)
                throw new Error('Invalidation source does not exist');
            const family = familyDocument.data();
            if (!APPROVED_STATUSES.includes(migrationState(family).status))
                return { status: 'ignored' };
            const completion = completionDocument.data();
            if (completion.gamificationEffectSnapshot === undefined)
                return { status: 'ignored' };
            const effect = effectFromData(completion.gamificationEffectSnapshot);
            if (effect.familyId !== args.familyId)
                throw new Error('Invalidation effect belongs to another family');
            const childRef = this.db.doc(`users/${effect.childId}`);
            const eligibilityRef = familyRef.collection('daily_eligibility').doc(`${effect.childId}:${effect.dayKey}`);
            const progressRef = familyRef.collection('daily_progress').doc(`${effect.childId}:${effect.dayKey}`);
            const summaryRef = familyRef.collection('gamification_summaries').doc(effect.childId);
            const checkpointRef = familyRef.collection('gamification_checkpoints').doc(effect.childId);
            const [childDocument, eligibilityDocument, progressDocument, summaryDocument, checkpointDocument] = await Promise.all([
                transaction.get(childRef), transaction.get(eligibilityRef), transaction.get(progressRef), transaction.get(summaryRef), transaction.get(checkpointRef),
            ]);
            if (!childDocument.exists || childDocument.data().familyId !== args.familyId)
                throw new Error('Invalidation child belongs to another family');
            if (!eligibilityDocument.exists)
                throw new Error('Invalidation is missing immutable eligibility');
            const snapshot = eligibilityFromData(eligibilityDocument.data());
            const progress = progressDocument.exists ? progressFromData(progressDocument.data()) : undefined;
            const [taskAwardDocument, taskReversalDocument, ...thresholdDocuments] = await Promise.all([
                transaction.get(familyRef.collection('gamification_events').doc((0, xp_1.taskXpEventId)(effect.logicalCompletionKey))),
                transaction.get(familyRef.collection('gamification_events').doc((0, xp_1.taskXpReversalEventId)(effect.logicalCompletionKey))),
                ...thresholdEventIds(args.familyId, effect.childId, effect.dayKey)
                    .map(id => transaction.get(familyRef.collection('gamification_events').doc(id))),
            ]);
            const existingEvents = eventMap([
                ...qualificationEventsFromProgress(progressDocument.data()),
                ...(taskAwardDocument.exists ? [eventFromDocument(taskAwardDocument)] : []),
                ...(taskReversalDocument.exists ? [eventFromDocument(taskReversalDocument)] : []),
                ...thresholdDocuments.filter(document => document.exists).map(eventFromDocument),
            ]);
            const invalidated = new Set(progress?.invalidatedLogicalCompletionKeys ?? []);
            invalidated.add(effect.logicalCompletionKey);
            const plan = (0, engine_1.planTaskReversal)({
                completionId: args.completionId,
                effect,
                eligibilitySnapshot: snapshot,
                eligibilitySnapshotId: eligibilityRef.id,
                completionEffects: [...syntheticEffects(progress, snapshot).filter(prior => prior.logicalCompletionKey !== effect.logicalCompletionKey)
                        .map((prior, index) => ({ completionId: `trusted-prior-${index}`, status: 'approved', effect: prior })),
                    { completionId: args.completionId, status: 'approved', effect }],
                invalidatedLogicalCompletionKeys: [...invalidated],
                existingEvents,
                existingEligibilitySnapshots: [snapshot],
                finalized: progress?.finalized ?? false,
                processingAt: args.processingAt,
                ...(args.immutableReversalId !== undefined ? { immutableReversalId: args.immutableReversalId } : {
                    authoritativeStatusChangedAt: optionalMillis(completion.cancelledAt ?? completion.invalidatedAt, 'completion status change') ?? args.processingAt,
                }),
            });
            if (plan.events.length === 0 && taskReversalDocument.exists)
                return { status: 'duplicate', logicalCompletionKey: effect.logicalCompletionKey };
            const summary = projectSummary(summaryDocument.exists ? summaryFromData(summaryDocument.data()) : undefined, args.familyId, effect.childId, plan.events, plan.progress, args.processingAt);
            const child = childDocument.data();
            const currentPoints = child.rewardPoints ?? 0;
            const legacyAlreadyReversed = args.immutableReversalId !== undefined && child.lastReversalId === args.immutableReversalId;
            const processorAlreadyReversed = completion.gamificationRewardRevokedBy !== undefined;
            if (!legacyAlreadyReversed && !processorAlreadyReversed) {
                const nextPoints = currentPoints - effect.rewardPointsAward;
                if (!Number.isSafeInteger(nextPoints) || nextPoints < 0)
                    throw new Error('Task invalidation would make rewardPoints invalid');
                transaction.update(childRef, { rewardPoints: nextPoints });
            }
            for (const document of plan.events)
                transaction.create(familyRef.collection('gamification_events').doc(document.id), eventToData(document.event));
            transaction.set(progressRef, progressToData(plan.progress, [...existingEvents, ...plan.events]));
            transaction.set(summaryRef, summaryToData(summary));
            transaction.update(completionRef, { gamificationRewardRevokedBy: args.immutableReversalId ?? `status:${completion.status}`, gamificationInvalidatedAt: timestamp(args.processingAt) });
            if (checkpointDocument.exists && checkpointDocument.data().dirty !== true)
                transaction.update(checkpointRef, { dirty: true });
            return { status: 'processed', logicalCompletionKey: effect.logicalCompletionKey };
        });
    }
    async listFamiliesForFinalization(_processingAt) {
        return (await this.db.collection('families').get()).docs
            .filter(document => APPROVED_STATUSES.includes(migrationState(document.data()).status))
            .map(document => document.id);
    }
    async finalizeFamilyDay(args) {
        const familyRef = this.db.doc(`families/${args.familyId}`);
        const family = await familyRef.get();
        if (!family.exists || !APPROVED_STATUSES.includes(migrationState(family.data()).status))
            return { snapshotsCreated: 0, daysFinalized: 0 };
        const timezone = timezoneOf(family.data());
        const currentDay = (0, dailyProgress_1.familyDayKey)(args.processingAt, timezone);
        const dayKey = args.dayKey ?? (0, dailyProgress_1.familyDayKey)(localDayStart(currentDay, timezone) - 1, timezone);
        const children = await this.db.collection('users').where('familyId', '==', args.familyId).where('role', '==', 'child').get();
        let snapshotsCreated = 0;
        let daysFinalized = 0;
        for (const child of children.docs) {
            if (child.data().status === 'deleted' || child.data().status === 'disabled' || child.data().disabled === true)
                continue;
            const result = await this.finalizeChildDay(args.familyId, child.id, dayKey, args.processingAt);
            snapshotsCreated += result.snapshotCreated ? 1 : 0;
            daysFinalized += result.finalized ? 1 : 0;
        }
        await this.advancePreparedMigrationIfReady(args.familyId, args.processingAt);
        return { snapshotsCreated, daysFinalized };
    }
    async finalizeChildDay(familyId, childId, dayKey, processingAt) {
        const familyRef = this.db.doc(`families/${familyId}`);
        return this.db.runTransaction(async (transaction) => {
            const familyDocument = await transaction.get(familyRef);
            const family = familyDocument.data();
            const timezone = timezoneOf(family);
            const eligibilityRef = familyRef.collection('daily_eligibility').doc(`${childId}:${dayKey}`);
            const progressRef = familyRef.collection('daily_progress').doc(`${childId}:${dayKey}`);
            const summaryRef = familyRef.collection('gamification_summaries').doc(childId);
            const checkpointRef = familyRef.collection('gamification_checkpoints').doc(childId);
            const [eligibilityDocument, progressDocument, summaryDocument, checkpointDocument, tasks] = await Promise.all([
                transaction.get(eligibilityRef), transaction.get(progressRef), transaction.get(summaryRef), transaction.get(checkpointRef),
                transaction.get(familyRef.collection('tasks').where('assigneeId', '==', childId)),
            ]);
            const snapshot = eligibilityDocument.exists ? eligibilityFromData(eligibilityDocument.data()) : (0, dailyEligibilityAdapter_1.buildDailyEligibilitySnapshot)({
                familyId, childId, dayKey, timezone, dailyGoalPercentage: (0, config_1.resolveGamificationConfig)(family.gamification).dailyGoalPercentage,
                tasks: tasks.docs.map(taskFromDocument), effectiveAt: localDayStart(dayKey, timezone), createdAt: processingAt,
            });
            const priorProgress = progressDocument.exists ? progressFromData(progressDocument.data()) : undefined;
            if (priorProgress?.finalized === true)
                return { snapshotCreated: false, finalized: false };
            const progress = (0, dailyProgress_1.calculateDailyProgress)({
                eligibilitySnapshot: snapshot, eligibilitySnapshotId: eligibilityRef.id,
                completionEffects: syntheticEffects(priorProgress, snapshot).map((effect, index) => ({ completionId: `trusted-${index}`, status: 'approved', effect })),
                invalidatedLogicalCompletionKeys: priorProgress?.invalidatedLogicalCompletionKeys ?? [], finalized: true, calculatedAt: processingAt,
            });
            const thresholdDocuments = await Promise.all(thresholdEventIds(familyId, childId, dayKey)
                .map(id => transaction.get(familyRef.collection('gamification_events').doc(id))));
            const existingEvents = eventMap([
                ...qualificationEventsFromProgress(progressDocument.data()),
                ...thresholdDocuments.filter(document => document.exists).map(eventFromDocument),
            ]);
            const events = (0, perfectDay_1.planThresholdEvents)({
                progress, sourceTransitionId: (0, types_1.finalizationSourceTransitionId)(eligibilityRef.id), effectiveAt: processingAt, existingEvents,
            });
            const summary = projectSummary(summaryDocument.exists ? summaryFromData(summaryDocument.data()) : undefined, familyId, childId, events, progress, processingAt, eligibilityDocument.exists ? [] : [{
                    effectiveAt: snapshot.effectiveAt, causalGroupId: snapshot.causalGroupId,
                    transitionRank: snapshot.transitionRank, documentId: eligibilityRef.id,
                }]);
            if (!eligibilityDocument.exists)
                transaction.create(eligibilityRef, eligibilityToData(snapshot));
            for (const document of events)
                transaction.create(familyRef.collection('gamification_events').doc(document.id), eventToData(document.event));
            transaction.set(progressRef, progressToData(progress, [...existingEvents, ...events]));
            transaction.set(summaryRef, summaryToData(summary));
            if (checkpointDocument.exists && checkpointDocument.data().dirty !== true)
                transaction.update(checkpointRef, { dirty: true });
            return { snapshotCreated: !eligibilityDocument.exists, finalized: true };
        });
    }
    async advancePreparedMigrationIfReady(familyId, processingAt) {
        const familyRef = this.db.doc(`families/${familyId}`);
        const family = await familyRef.get();
        if (!family.exists || migrationState(family.data()).status !== 'prepared')
            return;
        const children = await this.db.collection('users').where('familyId', '==', familyId).where('role', '==', 'child').get();
        for (const child of children.docs) {
            const lifetimeXp = child.data().lifetimeXP;
            if (Number.isSafeInteger(lifetimeXp) && lifetimeXp > 0) {
                const baseline = await familyRef.collection('gamification_events').doc(`legacy_xp_baseline:${encodeURIComponent(familyId)}:${encodeURIComponent(child.id)}`).get();
                if (!baseline.exists)
                    return;
            }
            const summary = await familyRef.collection('gamification_summaries').doc(child.id).get();
            if (summary.exists && (summary.data().rebuildRequired === true || summary.data().projectionStatus !== 'ready'))
                return;
        }
        await this.db.runTransaction(async (transaction) => {
            const latest = await transaction.get(familyRef);
            const state = migrationState(latest.data());
            if (state.status !== 'prepared')
                return;
            transaction.update(familyRef, {
                gamificationMigration: {
                    schemaVersion: 1, status: 'baseline_complete', cutoverAt: timestamp(state.cutoverAt),
                    migratedAt: timestamp(processingAt), repairBoundaryAt: timestamp(processingAt),
                },
            });
        });
    }
    async repairGamificationPage(args) {
        const familyRef = this.db.doc(`families/${args.familyId}`);
        const checkpointRef = familyRef.collection('gamification_checkpoints').doc(args.childId);
        let checkpointDocument = await checkpointRef.get();
        let checkpoint;
        let restarted = false;
        if (!checkpointDocument.exists || checkpointDocument.data().dirty === true) {
            const generationId = `generation:${args.processingAt}:${args.childId}`;
            checkpoint = {
                schemaVersion: 1, familyId: args.familyId, childId: args.childId, generationId,
                watermarkAt: timestamp(args.processingAt), dirty: false, eligibilityCursor: null, eventCursor: null,
                pendingRecords: [], accumulatedEligibility: [], accumulatedEvents: [],
            };
            await checkpointRef.set(checkpoint);
            checkpointDocument = await checkpointRef.get();
            restarted = true;
        }
        checkpoint = checkpointDocument.data();
        const eligibilityQuery = this.rebuildQuery(familyRef.collection('daily_eligibility'), args.childId, checkpoint.watermarkAt, checkpoint.eligibilityCursor);
        const eventQuery = this.rebuildQuery(familyRef.collection('gamification_events'), args.childId, checkpoint.watermarkAt, checkpoint.eventCursor);
        const [eligibilityPage, eventPage] = await Promise.all([eligibilityQuery.get(), eventQuery.get()]);
        const recordsRead = eligibilityPage.size + eventPage.size;
        if (recordsRead > args.maxRecords)
            throw new Error('Rebuild page exceeded the 250-record hard limit');
        const eligibilityRecords = eligibilityPage.docs.map(document => this.rebuildRecord(document, 'eligibility'));
        const eventRecords = eventPage.docs.map(document => this.rebuildRecord(document, 'event'));
        const pending = checkpoint.pendingRecords.map(record => ({
            ...record, effectiveAt: millis(record.effectiveAt, 'pending rebuild effectiveAt'), value: record.value,
        }));
        const merged = (0, gamificationRepair_1.mergeRebuildStreams)(pending, (0, gamificationRepair_1.mergeRebuildStreams)(eligibilityRecords, eventRecords));
        const exhausted = eligibilityPage.size < REBUILD_STREAM_LIMIT && eventPage.size < REBUILD_STREAM_LIMIT;
        const uncertainBoundaries = [
            ...(eligibilityPage.size === REBUILD_STREAM_LIMIT ? [eligibilityRecords.at(-1)] : []),
            ...(eventPage.size === REBUILD_STREAM_LIMIT ? [eventRecords.at(-1)] : []),
        ].sort((left, right) => left.effectiveAt - right.effectiveAt
            || (left.causalGroupId < right.causalGroupId ? -1 : left.causalGroupId > right.causalGroupId ? 1 : 0)
            || left.transitionRank - right.transitionRank
            || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
        const safeBoundary = uncertainBoundaries[0];
        const safe = safeBoundary === undefined ? merged : merged.filter(record => record.effectiveAt < safeBoundary.effectiveAt
            || (record.effectiveAt === safeBoundary.effectiveAt && (record.causalGroupId < safeBoundary.causalGroupId
                || (record.causalGroupId === safeBoundary.causalGroupId && (record.transitionRank < safeBoundary.transitionRank
                    || (record.transitionRank === safeBoundary.transitionRank && record.id <= safeBoundary.id))))));
        const deferred = safeBoundary === undefined ? [] : merged.slice(safe.length);
        const grouped = (0, gamificationRepair_1.takeCompleteCausalGroups)(safe, exhausted && deferred.length === 0);
        const pendingNext = (0, gamificationRepair_1.mergeRebuildStreams)(grouped.pending, deferred);
        const completeEligibility = grouped.complete.filter(record => record.stream === 'eligibility').map(record => record.value);
        const completeEvents = grouped.complete.filter(record => record.stream === 'event').map(record => ({ id: record.id, event: record.value }));
        const next = {
            ...checkpoint,
            eligibilityCursor: eligibilityPage.empty ? checkpoint.eligibilityCursor : this.storedCursor(eligibilityPage.docs.at(-1)),
            eventCursor: eventPage.empty ? checkpoint.eventCursor : this.storedCursor(eventPage.docs.at(-1)),
            pendingRecords: pendingNext.map(record => ({ ...record, effectiveAt: timestamp(record.effectiveAt), value: record.value })),
            accumulatedEligibility: [...checkpoint.accumulatedEligibility, ...completeEligibility],
            accumulatedEvents: [...checkpoint.accumulatedEvents, ...completeEvents],
        };
        if (!exhausted || pendingNext.length > 0) {
            await checkpointRef.set(next);
            return { status: restarted ? 'restarted' : 'checkpointed', recordsRead, generationId: checkpoint.generationId };
        }
        const eligibility = next.accumulatedEligibility.map(eligibilityFromData);
        const events = next.accumulatedEvents.map(document => ({ id: document.id, event: eventFromData(document.event) }));
        const summary = eligibility.length === 0 && events.length === 0
            ? defaultSummary(args.familyId, args.childId, args.processingAt)
            : (0, engine_1.rebuildGamificationSummary)({ eligibilitySnapshots: eligibility, events, processingAt: args.processingAt });
        await this.db.runTransaction(async (transaction) => {
            const latest = await transaction.get(checkpointRef);
            if (!latest.exists || latest.data().generationId !== checkpoint.generationId || latest.data().dirty === true)
                return;
            const summaryRef = familyRef.collection('gamification_summaries').doc(args.childId);
            const prior = await transaction.get(summaryRef);
            transaction.set(summaryRef, summaryToData({ ...summary, projectionRevision: (prior.data()?.projectionRevision ?? 0) + 1 }));
            transaction.delete(checkpointRef);
        });
        return { status: 'published', recordsRead, generationId: checkpoint.generationId };
    }
    rebuildQuery(collection, childId, watermark, cursor) {
        let query = collection
            .where('childId', '==', childId)
            .where('effectiveAt', '<=', watermark)
            .orderBy('effectiveAt')
            .orderBy('causalGroupId')
            .orderBy('transitionRank')
            .orderBy('__name__');
        if (cursor !== null)
            query = query.startAfter(cursor.effectiveAt, cursor.causalGroupId, cursor.transitionRank, cursor.documentId);
        return query.limit(REBUILD_STREAM_LIMIT);
    }
    rebuildRecord(document, stream) {
        const data = document.data();
        return {
            id: document.id, effectiveAt: millis(data.effectiveAt, `${stream} effectiveAt`), causalGroupId: data.causalGroupId,
            transitionRank: data.transitionRank, stream, value: data,
        };
    }
    storedCursor(document) {
        const data = document.data();
        return { effectiveAt: data.effectiveAt, causalGroupId: data.causalGroupId, transitionRank: data.transitionRank, documentId: document.id };
    }
    async repairPostCutoverPage(args) {
        const familyRef = this.db.doc(`families/${args.familyId}`);
        const familyDocument = await familyRef.get();
        if (!familyDocument.exists)
            throw new Error(`Family ${args.familyId} does not exist`);
        const migration = migrationState(familyDocument.data());
        if (migration.status !== 'baseline_complete' && migration.status !== 'active')
            return { status: 'waiting', recordsRead: 0 };
        if (migration.status === 'active')
            return { status: 'active', recordsRead: 0 };
        if (migration.cutoverAt === undefined)
            throw new Error('baseline_complete migration is missing cutoverAt');
        const boundary = migration.repairBoundaryAt ?? args.processingAt;
        let query = familyRef.collection('task_completions')
            .where('approvedAt', '>=', timestamp(migration.cutoverAt))
            .where('approvedAt', '<=', timestamp(boundary))
            .orderBy('approvedAt')
            .orderBy('__name__');
        if (migration.repairCheckpoint !== undefined) {
            const prior = await familyRef.collection('task_completions').doc(migration.repairCheckpoint).get();
            if (prior.exists)
                query = query.startAfter(prior.data().approvedAt, prior.id);
        }
        const page = await query.limit(args.maxRecords).get();
        for (const completion of page.docs) {
            await this.processApprovedCompletion({ familyId: args.familyId, completionId: completion.id, processingAt: args.processingAt });
        }
        if (page.size === args.maxRecords) {
            await familyRef.update({
                'gamificationMigration.repairCheckpoint': page.docs.at(-1).id,
                'gamificationMigration.repairBoundaryAt': timestamp(boundary),
            });
            return { status: 'checkpointed', recordsRead: page.size };
        }
        await this.db.runTransaction(async (transaction) => {
            const latest = await transaction.get(familyRef);
            const state = migrationState(latest.data());
            if (state.status !== 'baseline_complete')
                return;
            transaction.update(familyRef, {
                gamificationMigration: {
                    schemaVersion: 1, status: 'active', cutoverAt: timestamp(state.cutoverAt), migratedAt: timestamp(args.processingAt),
                    repairBoundaryAt: timestamp(boundary), repairCheckpoint: page.docs.at(-1)?.id ?? state.repairCheckpoint ?? null,
                },
            });
        });
        return { status: 'active', recordsRead: page.size };
    }
}
exports.AdminGamificationRepository = AdminGamificationRepository;
function eventFromData(data) {
    return {
        ...data,
        effectiveAt: millis(data.effectiveAt, 'event effectiveAt'),
        createdAt: millis(data.createdAt, 'event createdAt'),
        ...(data.migratedAt !== undefined ? { migratedAt: millis(data.migratedAt, 'event migratedAt') } : {}),
    };
}
//# sourceMappingURL=gamificationRepository.js.map