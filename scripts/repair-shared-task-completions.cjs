/**
 * Generic, idempotent repair for approved POST-CUTOVER task completions that
 * were never awarded solely because the task had no `assigneeId`
 * (shared/family-wide task) or that otherwise left no gamification trace.
 *
 * DRY-RUN BY DEFAULT. Nothing is written unless `--execute` is passed.
 * No member, family or completion is hard-coded.
 *
 * Usage:
 *   node scripts/repair-shared-task-completions.cjs             # dry run, all families
 *   node scripts/repair-shared-task-completions.cjs --family=ID # dry run, one family
 *   node scripts/repair-shared-task-completions.cjs --execute   # apply repairs
 */
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const svc = require('./../firebase-key.json');

initializeApp({ credential: cert(svc), projectId: svc.project_id || 'familyquest-beta-402cb' });
const db = getFirestore();

const EXECUTE = process.argv.includes('--execute');
const FAMILY_FILTER = (process.argv.find(a => a.startsWith('--family=')) || '').split('=')[1] || null;
const REPAIR_MARKER = 'sharedTaskAwardRepairV1';
const PROCESSOR_VERSION = 'gamification-processor-v2-shared-tasks';

const ms = (value) => {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return null;
};
const iso = (value) => (ms(value) === null ? null : new Date(ms(value)).toISOString());

async function familyIds() {
  if (FAMILY_FILTER) return [FAMILY_FILTER];
  return (await db.collection('families').get()).docs.map(d => d.id);
}

async function classify(familyId, family, completion) {
  const data = completion.data();
  const childId = data.assigneeId;
  const taskId = data.taskId;
  const skip = (reason) => ({ eligible: false, reason });

  if (data.status !== 'approved') return skip('status_not_approved');
  const migration = family.gamificationMigration || {};
  const cutoverAt = ms(migration.cutoverAt);
  const approvedAt = ms(data.approvedAt);
  if (cutoverAt === null) return skip('family_has_no_cutover');
  if (approvedAt === null) return skip('completion_has_no_approvedAt');
  if (approvedAt < cutoverAt) return skip('pre_cutover');
  if (typeof childId !== 'string' || typeof taskId !== 'string') return skip('completion_identity_invalid');

  if (data.gamificationEffectSnapshot !== undefined) return skip('already_has_effect_snapshot');
  if (data.gamificationProcessedAt !== undefined) return skip('already_processed');
  if (data.awardedPoints !== undefined) return skip('already_awarded_points');
  if (data[REPAIR_MARKER] !== undefined) return skip('already_repaired');

  const taskDoc = await db.doc(`families/${familyId}/tasks/${taskId}`).get();
  if (!taskDoc.exists) return skip('task_missing');
  const task = taskDoc.data();
  if (typeof task.assigneeId === 'string' && task.assigneeId !== childId) return skip('task_assigned_to_another_child');
  const points = task.pointsReward;
  if (!Number.isSafeInteger(points) || points < 0) return skip('task_reward_invalid');

  const childDoc = await db.doc(`users/${childId}`).get();
  if (!childDoc.exists) return skip('child_missing');
  const child = childDoc.data();
  if (child.familyId !== familyId || child.role !== 'child'
    || child.status === 'deleted' || child.status === 'disabled' || child.disabled === true) {
    return skip('child_not_active_in_family');
  }

  const occurrences = await db.collection(`families/${familyId}/task_occurrences`)
    .where('completionId', '==', completion.id).get();
  if (!occurrences.empty) return skip('task_occurrence_exists');

  const events = await db.collection(`families/${familyId}/gamification_events`)
    .where('sourceCompletionId', '==', completion.id).get().catch(() => ({ empty: true }));
  if (!events.empty) return skip('gamification_event_exists');

  const summary = await db.doc(`families/${familyId}/gamification_summaries/${childId}`).get();

  return {
    eligible: true,
    classification: typeof task.assigneeId === 'string' && task.assigneeId.length > 0
      ? 'assigned_task_unprocessed'
      : 'shared_task_missing_assignee',
    familyId,
    memberId: childId,
    displayName: child.displayName || child.name || null,
    completionId: completion.id,
    taskId,
    taskTitle: task.title || null,
    approvedAt: iso(data.approvedAt),
    points,
    currentRewardPoints: child.rewardPoints ?? 0,
    currentXpTotal: summary.exists ? (summary.data().xpTotal ?? 0) : 0,
    proposedRewardPointsDelta: points,
    proposedXpDelta: points,
    failureEvidence: {
      taskAssigneeId: task.assigneeId ?? null,
      hasOccurrence: false,
      hasGamificationEvent: false,
      hasEffectSnapshot: false,
      hasProcessedAt: false,
      hasRepairMarker: false,
      awardedPoints: null,
    },
  };
}

async function main() {
  const candidates = [];
  const skipped = [];
  for (const familyId of await familyIds()) {
    const familyDoc = await db.doc(`families/${familyId}`).get();
    if (!familyDoc.exists) continue;
    const family = familyDoc.data();
    const completions = await db.collection(`families/${familyId}/task_completions`)
      .where('status', '==', 'approved').get();
    for (const completion of completions.docs) {
      const result = await classify(familyId, family, completion);
      if (result.eligible) candidates.push(result);
      else skipped.push({ familyId, completionId: completion.id, reason: result.reason });
    }
  }

  console.log(JSON.stringify({
    mode: EXECUTE ? 'EXECUTE' : 'DRY_RUN',
    processorVersion: PROCESSOR_VERSION,
    candidateCount: candidates.length,
    candidates,
    skippedCount: skipped.length,
    skipped,
  }, null, 2));

  if (!EXECUTE) return;

  for (const candidate of candidates) {
    // Idempotent: re-touch the completion so the deployed processor replays it,
    // and stamp a repair marker so a second run never re-applies.
    const completionRef = db.doc(`families/${candidate.familyId}/task_completions/${candidate.completionId}`);
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(completionRef);
      const data = current.data() || {};
      if (data[REPAIR_MARKER] !== undefined || data.gamificationProcessedAt !== undefined) return;
      transaction.update(completionRef, {
        [REPAIR_MARKER]: { repairedAt: new Date(), processorVersion: PROCESSOR_VERSION },
        gamificationRepairRequestedAt: new Date(),
      });
    });
    console.log('repair-triggered', candidate.familyId, candidate.completionId);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
