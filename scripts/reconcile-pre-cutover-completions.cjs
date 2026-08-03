/**
 * READ-ONLY pre-cutover reconciliation report.
 *
 * Classifies every approved PRE-cutover task completion as:
 *   - definitely_included_in_baseline
 *   - definitely_excluded_from_baseline
 *   - ambiguous
 *
 * It performs no writes and proposes no repair. Only
 * "definitely_excluded_from_baseline" may later be considered for repair.
 * Task.points values are NOT used to guess a baseline; only recorded
 * award evidence and the adopted baseline snapshot are considered.
 *
 * Usage: node scripts/reconcile-pre-cutover-completions.cjs [--family=ID]
 */
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const svc = require('./../firebase-key.json');

initializeApp({ credential: cert(svc), projectId: svc.project_id || 'familyquest-beta-402cb' });
const db = getFirestore();

const FAMILY_FILTER = (process.argv.find(a => a.startsWith('--family=')) || '').split('=')[1] || null;

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

async function main() {
  const rows = [];
  for (const familyId of await familyIds()) {
    const familyDoc = await db.doc(`families/${familyId}`).get();
    if (!familyDoc.exists) continue;
    const migration = familyDoc.data().gamificationMigration || {};
    const cutoverAt = ms(migration.cutoverAt);
    if (cutoverAt === null) continue;

    const completions = await db.collection(`families/${familyId}/task_completions`)
      .where('status', '==', 'approved').get();

    for (const completion of completions.docs) {
      const data = completion.data();
      const approvedAt = ms(data.approvedAt);
      if (approvedAt === null || approvedAt >= cutoverAt) continue;

      const childId = data.assigneeId;
      const child = typeof childId === 'string' ? await db.doc(`users/${childId}`).get() : { exists: false };
      const summary = typeof childId === 'string'
        ? await db.doc(`families/${familyId}/gamification_summaries/${childId}`).get()
        : { exists: false };

      // Evidence that the legacy award actually happened at the time.
      const hasLegacyAward = data.awardedPoints !== undefined || data.effectSnapshot !== undefined;
      // Evidence that the adopted baseline was derived from legacy lifetimeXP.
      const baselineSource = summary.exists ? (summary.data().baselineSource ?? null) : null;
      const baselineAdoptedFromLifetimeXP = baselineSource === 'legacy_lifetime_xp'
        || (summary.exists && summary.data().baselineLifetimeXP !== undefined);

      let classification;
      if (hasLegacyAward && baselineAdoptedFromLifetimeXP) classification = 'definitely_included_in_baseline';
      else if (!hasLegacyAward && summary.exists && baselineSource !== null) classification = 'definitely_excluded_from_baseline';
      else classification = 'ambiguous';

      rows.push({
        familyId,
        memberId: childId ?? null,
        displayName: child.exists ? (child.data().displayName || child.data().name || null) : null,
        completionId: completion.id,
        taskId: data.taskId ?? null,
        approvedAt: iso(data.approvedAt),
        cutoverAt: new Date(cutoverAt).toISOString(),
        awardedPoints: data.awardedPoints ?? null,
        hasLegacyEffectSnapshot: data.effectSnapshot !== undefined,
        baselineSource,
        currentXpTotal: summary.exists ? (summary.data().xpTotal ?? 0) : null,
        currentLifetimeXP: child.exists ? (child.data().lifetimeXP ?? 0) : null,
        classification,
      });
    }
  }

  const counts = rows.reduce((acc, row) => ({ ...acc, [row.classification]: (acc[row.classification] || 0) + 1 }), {});
  console.log(JSON.stringify({ mode: 'READ_ONLY', totals: counts, rowCount: rows.length, rows }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
