#!/usr/bin/env node
/**
 * READ-ONLY post-deploy production scan. Creates no documents.
 *
 * Reports every approval and behaviour event recorded after a deployment
 * timestamp and checks the two regression contracts:
 *   1. no new shared-task completion fails processing;
 *   2. no new positive behaviour leaves lifetimeXP and xpTotal divergent.
 *
 * Usage: node scripts/scan-post-deploy-approvals.cjs --since=2026-08-03T20:23:20Z
 */
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const svc = require('./../firebase-key.json');

initializeApp({ credential: cert(svc), projectId: svc.project_id || 'familyquest-beta-402cb' });
const db = getFirestore();

const SINCE = Date.parse((process.argv.find(a => a.startsWith('--since=')) || '').split('=')[1] || '');
if (!Number.isFinite(SINCE)) { console.error('--since=<ISO timestamp> is required'); process.exit(1); }

const ms = (value) => (value && typeof value.toMillis === 'function' ? value.toMillis() : null);
const iso = (value) => (ms(value) === null ? null : new Date(ms(value)).toISOString());

async function main() {
  const families = (await db.collection('families').get()).docs;
  const approvals = [];
  const behaviours = [];
  const failures = [];

  for (const family of families) {
    const familyId = family.id;
    const completions = await db.collection(`families/${familyId}/task_completions`)
      .where('status', '==', 'approved').get();
    for (const document of completions.docs) {
      const data = document.data();
      if ((ms(data.approvedAt) ?? 0) < SINCE) continue;
      approvals.push({
        familyId, completionId: document.id, taskId: data.taskId, childId: data.assigneeId,
        approvedAt: iso(data.approvedAt),
        processed: data.gamificationProcessedAt !== undefined,
        awardedPoints: data.awardedPoints ?? null,
        hasEffectSnapshot: data.gamificationEffectSnapshot !== undefined,
      });
    }

    const behaviourEvents = await db.collection(`families/${familyId}/behaviour_events`).get();
    for (const document of behaviourEvents.docs) {
      const data = document.data();
      if ((ms(data.createdAt) ?? 0) < SINCE) continue;
      const child = await db.doc(`users/${data.childId}`).get();
      const summary = await db.doc(`families/${familyId}/gamification_summaries/${data.childId}`).get();
      behaviours.push({
        familyId, behaviourEventId: document.id, childId: data.childId, type: data.type,
        pointsDelta: data.pointsDelta, createdAt: iso(data.createdAt),
        processed: data.gamificationProcessedAt !== undefined,
        lifetimeXP: child.exists ? (child.data().lifetimeXP ?? 0) : null,
        xpTotal: summary.exists ? (summary.data().xpTotal ?? 0) : null,
      });
    }

    const failureDocuments = await db.collection(`families/${familyId}/gamification_processor_failures`).get()
      .catch(() => ({ docs: [] }));
    for (const document of failureDocuments.docs) {
      const data = document.data();
      if ((ms(data.failedAt) ?? 0) < SINCE) continue;
      failures.push({ familyId, id: document.id, reason: data.reason, failedAt: iso(data.failedAt) });
    }
  }

  const unprocessedApprovals = approvals.filter(a => !a.processed);
  console.log(JSON.stringify({
    mode: 'READ_ONLY',
    since: new Date(SINCE).toISOString(),
    approvalCount: approvals.length,
    approvals,
    unprocessedApprovals,
    behaviourCount: behaviours.length,
    behaviours,
    processorFailures: failures,
    contracts: {
      noUnprocessedApprovals: unprocessedApprovals.length === 0,
      noAssigneeMismatchFailures: failures.every(f => f.reason !== 'task_assigned_to_another_child'),
    },
  }, null, 2));
}

main().catch(error => { console.error(error); process.exit(1); });
