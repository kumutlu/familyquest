#!/usr/bin/env node
/**
 * READ-ONLY dump of the exact inputs required by the Stage B repair simulation.
 *
 * Performs NO writes. Emits a single JSON document to stdout containing, for
 * each requested child: the users doc, the authoritative gamification summary,
 * every gamification_event, every daily_eligibility snapshot, every
 * daily_progress doc, and the task_completions referenced by the repair.
 *
 * Usage:
 *   node scripts/dump-repair-inputs.cjs <childId> [<childId> ...] > dump.json
 */
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './firebase-key.json';
initializeApp({ credential: cert(require(path.resolve(keyPath))) });
const db = getFirestore();

const docs = (snap) => snap.docs.map((d) => ({ id: d.id, data: d.data() }));

async function childBundle(childId) {
  const userSnap = await db.doc(`users/${childId}`).get();
  if (!userSnap.exists) return { childId, error: 'users doc not found' };
  const user = userSnap.data();
  const familyId = user.familyId;
  if (!familyId) return { childId, error: 'user has no familyId' };

  const familyPath = `families/${familyId}`;
  const [summary, events, eligibility, progress, completions] = await Promise.all([
    db.doc(`${familyPath}/gamification_summaries/${childId}`).get(),
    db.collection(`${familyPath}/gamification_events`).where('childId', '==', childId).get(),
    db.collection(`${familyPath}/daily_eligibility`).where('childId', '==', childId).get(),
    db.collection(`${familyPath}/daily_progress`).where('childId', '==', childId).get(),
    db.collection(`${familyPath}/task_completions`).where('childId', '==', childId).get()
      .catch(() => ({ docs: [] })),
  ]);

  return {
    childId,
    familyId,
    user: {
      displayName: user.displayName ?? user.name ?? null,
      role: user.role ?? null,
      rewardPoints: user.rewardPoints ?? null,
      lifetimeXP: user.lifetimeXP ?? null,
    },
    summary: summary.exists ? summary.data() : null,
    events: docs(events),
    eligibility: docs(eligibility),
    progress: docs(progress),
    completions: docs(completions),
  };
}

(async () => {
  const childIds = process.argv.slice(2);
  if (childIds.length === 0) {
    console.error('usage: node scripts/dump-repair-inputs.cjs <childId> [...]');
    process.exit(2);
  }
  const bundles = [];
  for (const childId of childIds) bundles.push(await childBundle(childId));
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), bundles }, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error('DUMP_FAILED:', e.message);
  process.exit(1);
});
