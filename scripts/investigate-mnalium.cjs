/**
 * READ-ONLY production investigation for the "rewardPoints up, lifetimeXP 0" P0.
 *
 * Performs no writes. Resolves the member by displayName, then dumps the exact
 * records required to trace one approved completion end-to-end.
 *
 * Usage: node scripts/investigate-mnalium.cjs [memberName]
 */
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const svc = require('./../firebase-key.json');

initializeApp({ credential: cert(svc), projectId: svc.project_id || 'familyquest-beta-402cb' });
const db = getFirestore();

const NAME = process.argv[2] || 'Mnalium';

const plain = (value) => JSON.parse(JSON.stringify(value, (_k, v) =>
  v && typeof v === 'object' && typeof v._seconds === 'number'
    ? new Date(v._seconds * 1000).toISOString()
    : v));

async function main() {
  const users = await db.collection('users').where('name', '==', NAME).get();
  const byDisplay = await db.collection('users').where('displayName', '==', NAME).get();
  const docs = [...users.docs, ...byDisplay.docs];
  if (docs.length === 0) {
    console.log(`No user found with name/displayName == ${NAME}`);
    process.exit(0);
  }
  for (const user of docs) {
    const data = user.data();
    const familyId = data.familyId;
    console.log('=== USER ===', user.id);
    console.log(plain({
      familyId,
      role: data.role,
      authUid: data.authUid ?? data.uid ?? null,
      rewardPoints: data.rewardPoints ?? null,
      lifetimeXP: data.lifetimeXP ?? null,
      currentStreak: data.currentStreak ?? null,
      longestStreak: data.longestStreak ?? null,
      lastTaskCompletionId: data.lastTaskCompletionId ?? null,
    }));

    const family = await db.doc(`families/${familyId}`).get();
    console.log('=== FAMILY gamificationMigration ===');
    console.log(plain(family.data()?.gamificationMigration ?? null));

    const summary = await db.doc(`families/${familyId}/gamification_summaries/${user.id}`).get();
    console.log('=== SUMMARY ===', summary.exists ? 'exists' : 'MISSING');
    if (summary.exists) console.log(plain(summary.data()));

    const completions = await db.collection(`families/${familyId}/task_completions`)
      .where('assigneeId', '==', user.id).get();
    const approved = completions.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.status === 'approved')
      .sort((a, b) => (b.approvedAt?._seconds ?? 0) - (a.approvedAt?._seconds ?? 0));
    console.log('=== COMPLETIONS ===', 'total', completions.size, 'approved', approved.length);
    for (const c of approved.slice(0, 5)) {
      console.log(plain({
        id: c.id, taskId: c.taskId, status: c.status, approvedAt: c.approvedAt,
        awardedPoints: c.awardedPoints ?? null,
        gamificationProcessedAt: c.gamificationProcessedAt ?? null,
        hasEffectSnapshot: c.gamificationEffectSnapshot !== undefined,
      }));
    }

    const occurrences = await db.collection(`families/${familyId}/task_occurrences`)
      .where('childId', '==', user.id).get();
    console.log('=== OCCURRENCES ===', occurrences.size);
    occurrences.docs.slice(0, 5).forEach(d => console.log(d.id, plain(d.data().effectId ?? null)));

    const events = await db.collection(`families/${familyId}/gamification_events`)
      .where('childId', '==', user.id).get();
    const xpSum = events.docs.reduce((sum, d) => sum + (d.data().xpDelta ?? 0), 0);
    console.log('=== EVENTS ===', events.size, 'xpDelta sum', xpSum);
    events.docs.slice(0, 10).forEach(d =>
      console.log(d.id, d.data().eventType, d.data().xpDelta));
  }
  process.exit(0);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
