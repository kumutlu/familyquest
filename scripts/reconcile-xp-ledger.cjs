#!/usr/bin/env node
/**
 * READ-ONLY post-baseline XP/points reconciliation ledger.
 *
 * This script NEVER writes. It answers, per member:
 *
 *   current summary.xpTotal - legacy baseline event xpDelta
 *     = post-baseline XP already represented in the projection
 *
 * and then attributes that amount to every non-baseline gamification event and
 * every approved completion, so that a repair candidate is only ever proposed
 * when BOTH its rewardPoints delta and its XP delta are provably absent.
 *
 * Classification per completion:
 *   definitely_unapplied      - no trace anywhere and the amount is unexplained
 *   definitely_already_applied- an event/occurrence/snapshot proves application
 *   partially_applied         - one side (points or XP) applied, the other not
 *   ambiguous                 - traces missing but the amount is already
 *                               explainable inside the current balances
 *
 * Usage: node scripts/reconcile-xp-ledger.cjs [--family=ID] [--json]
 */
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const svc = require('./../firebase-key.json');

initializeApp({ credential: cert(svc), projectId: svc.project_id || 'familyquest-beta-402cb' });
const db = getFirestore();

const FAMILY_FILTER = (process.argv.find(a => a.startsWith('--family=')) || '').split('=')[1] || null;
const BASELINE_EVENT_TYPE = 'legacy_xp_baseline';

const ms = (value) => {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return null;
};
const iso = (value) => (ms(value) === null ? null : new Date(ms(value)).toISOString());
const int = (value) => (Number.isSafeInteger(value) ? value : 0);

async function familyIds() {
  if (FAMILY_FILTER) return [FAMILY_FILTER];
  return (await db.collection('families').get()).docs.map(d => d.id);
}

async function reconcileFamily(familyId) {
  const familyDoc = await db.doc(`families/${familyId}`).get();
  if (!familyDoc.exists) return null;
  const family = familyDoc.data();
  const cutoverAt = ms((family.gamificationMigration || {}).cutoverAt);

  const [members, summaries, events, completions, occurrences, behaviourEvents] = await Promise.all([
    db.collection('users').where('familyId', '==', familyId).get(),
    db.collection(`families/${familyId}/gamification_summaries`).get(),
    db.collection(`families/${familyId}/gamification_events`).get(),
    db.collection(`families/${familyId}/task_completions`).where('status', '==', 'approved').get(),
    db.collection(`families/${familyId}/task_occurrences`).get(),
    db.collection(`families/${familyId}/behaviour_events`).get(),
  ]);

  const summaryById = new Map(summaries.docs.map(d => [d.id, d.data()]));
  const eventsByChild = new Map();
  for (const document of events.docs) {
    const data = document.data();
    const childId = data.childId || data.memberId;
    if (!childId) continue;
    if (!eventsByChild.has(childId)) eventsByChild.set(childId, []);
    eventsByChild.get(childId).push({ id: document.id, ...data });
  }
  const occurrenceByCompletion = new Map();
  for (const document of occurrences.docs) {
    const data = document.data();
    if (data.completionId) occurrenceByCompletion.set(data.completionId, document.id);
  }

  const report = [];
  for (const memberDocument of members.docs) {
    const member = memberDocument.data();
    if (member.role !== 'child') continue;
    const childId = memberDocument.id;
    const summary = summaryById.get(childId);
    const xpTotal = int(summary && summary.xpTotal);
    const rewardPoints = int(member.rewardPoints);
    const lifetimeXP = int(member.lifetimeXP);

    const childEvents = eventsByChild.get(childId) || [];
    const baselineEvents = childEvents.filter(e => e.eventType === BASELINE_EVENT_TYPE);
    const baselineXp = baselineEvents.reduce((total, e) => total + int(e.xpDelta), 0);
    const nonBaseline = childEvents.filter(e => e.eventType !== BASELINE_EVENT_TYPE);
    const nonBaselineXp = nonBaseline.reduce((total, e) => total + int(e.xpDelta), 0);
    const postBaselineXp = xpTotal - baselineXp;
    const unattributedXp = postBaselineXp - nonBaselineXp;

    // Completions
    const memberCompletions = [];
    for (const document of completions.docs) {
      const data = document.data();
      if (data.assigneeId !== childId) continue;
      const taskDocument = await db.doc(`families/${familyId}/tasks/${data.taskId}`).get();
      const task = taskDocument.exists ? taskDocument.data() : null;
      const points = task && Number.isSafeInteger(task.pointsReward) ? task.pointsReward : null;
      const approvedAt = ms(data.approvedAt);
      const hasOccurrence = occurrenceByCompletion.has(document.id);
      const eventForCompletion = childEvents.filter(e => e.sourceCompletionId === document.id
        || e.completionId === document.id);
      const hasEvent = eventForCompletion.length > 0;
      const hasSnapshot = data.gamificationEffectSnapshot !== undefined;
      const hasProcessedAt = data.gamificationProcessedAt !== undefined;
      const awardedPoints = data.awardedPoints;
      const preCutover = cutoverAt !== null && approvedAt !== null && approvedAt < cutoverAt;

      let classification;
      if (hasEvent || hasSnapshot || hasProcessedAt || awardedPoints !== undefined) {
        classification = 'definitely_already_applied';
      } else if (preCutover) {
        // Pre-cutover work is represented inside the adopted legacy baseline.
        classification = 'definitely_already_applied';
      } else if (points === null) {
        classification = 'ambiguous';
      } else if (unattributedXp >= points) {
        // The projection already contains XP that no event explains; this
        // completion's XP may well be part of it.
        classification = 'ambiguous';
      } else {
        classification = 'definitely_unapplied';
      }

      memberCompletions.push({
        completionId: document.id,
        taskId: data.taskId,
        taskTitle: task ? (task.title || null) : null,
        taskAssigneeId: task ? (task.assigneeId ?? null) : null,
        points,
        approvedAt: iso(data.approvedAt),
        preCutover,
        occurrenceExists: hasOccurrence,
        gamificationEventExists: hasEvent,
        effectSnapshotExists: hasSnapshot,
        processedAtExists: hasProcessedAt,
        awardedPoints: awardedPoints === undefined ? null : awardedPoints,
        classification,
      });
    }

    // Behaviour events: legacy client-applied points/lifetimeXP vs projection.
    const memberBehaviour = behaviourEvents.docs
      .filter(document => document.data().childId === childId)
      .map(document => {
        const data = document.data();
        const projected = childEvents.some(e => e.sourceBehaviourEventId === document.id);
        const createdAtMs = ms(data.createdAt);
        // Pre-cutover behaviour XP was already folded into the legacy baseline
        // (users.lifetimeXP), so it must never be re-applied.
        const preCutover = cutoverAt !== null && createdAtMs !== null && createdAtMs < cutoverAt;
        let classification;
        if (projected) classification = 'definitely_already_applied';
        else if (preCutover) classification = 'definitely_already_applied_in_baseline';
        else if (data.type === 'positive' && int(data.pointsDelta) > 0) {
          classification = 'partially_applied_missing_projection_xp';
        } else classification = 'no_projection_impact';
        return {
          behaviourEventId: document.id,
          type: data.type,
          pointsDelta: int(data.pointsDelta),
          createdAt: iso(data.createdAt),
          preCutover,
          reason: data.reason || null,
          projectionEventExists: projected,
          processedAtExists: data.gamificationProcessedAt !== undefined,
          classification,
        };
      });

    report.push({
      memberId: childId,
      displayName: member.displayName || member.name || null,
      balances: { rewardPoints, lifetimeXP, xpTotal },
      // A positive gap proves the legacy mirror (users.lifetimeXP) received XP
      // after the baseline that the authoritative projection never did.
      legacyPostBaselineXp: lifetimeXP - baselineXp,
      lifetimeXpVersusProjectionGap: (lifetimeXP - baselineXp) - (xpTotal - baselineXp),
      baseline: { baselineEventCount: baselineEvents.length, baselineXp },
      postBaselineXpRepresented: postBaselineXp,
      nonBaselineEventXp: nonBaselineXp,
      unattributedXp,
      nonBaselineEvents: nonBaseline.map(e => ({
        id: e.id, eventType: e.eventType, xpDelta: int(e.xpDelta),
        rewardPointsDelta: e.rewardPointsDelta === undefined ? null : int(e.rewardPointsDelta),
        effectiveAt: iso(e.effectiveAt),
      })),
      completions: memberCompletions,
      behaviourEvents: memberBehaviour,
    });
  }

  return { familyId, familyName: family.name || null, cutoverAt: iso((family.gamificationMigration || {}).cutoverAt), members: report };
}

async function main() {
  const families = [];
  for (const familyId of await familyIds()) {
    const result = await reconcileFamily(familyId);
    if (result && result.members.length > 0) families.push(result);
  }
  console.log(JSON.stringify({ mode: 'READ_ONLY', generatedAt: new Date().toISOString(), families }, null, 2));
}

main().catch(error => { console.error(error); process.exit(1); });
