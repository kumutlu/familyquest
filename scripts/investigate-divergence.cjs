/**
 * READ-ONLY production investigation: rewardPoints vs lifetimeXP divergence.
 * Performs ZERO writes. Usage: node scripts/investigate-divergence.cjs [memberName]
 */
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const svc = require('./../firebase-key.json');

initializeApp({ credential: cert(svc), projectId: svc.project_id || 'familyquest-beta-402cb' });
const db = getFirestore();

const NAME = process.argv[2] || 'Mnalium';

const ts = (v) => {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (typeof v._seconds === 'number') return new Date(v._seconds * 1000).toISOString();
  return v;
};
const j = (o) => JSON.stringify(o, null, 2);

async function safeGet(fn, label) {
  try { return await fn(); } catch (e) { console.log(`  [skip ${label}: ${e.message}]`); return null; }
}

async function main() {
  const a = await db.collection('users').where('name', '==', NAME).get();
  const b = await db.collection('users').where('displayName', '==', NAME).get();
  const seen = new Set();
  const docs = [...a.docs, ...b.docs].filter(d => (seen.has(d.id) ? false : seen.add(d.id)));
  if (!docs.length) { console.log('NO USER FOUND for', NAME); process.exit(0); }

  for (const user of docs) {
    const d = user.data();
    const fid = d.familyId;
    console.log('\n########## STEP 1: users/' + user.id + ' ##########');
    console.log(j({
      familyId: fid, role: d.role,
      rewardPoints: d.rewardPoints ?? null,
      lifetimeXP: d.lifetimeXP ?? null,
      currentStreak: d.currentStreak ?? null,
      lastTaskCompletionId: d.lastTaskCompletionId ?? null,
      totalPointsEarned: d.totalPointsEarned ?? null,
      pointsSpent: d.pointsSpent ?? null,
      createdAt: ts(d.createdAt), updatedAt: ts(d.updatedAt),
    }));
    console.log('ALL USER KEYS:', Object.keys(d).sort().join(', '));

    const fam = await db.doc(`families/${fid}`).get();
    console.log('\n--- family.gamificationMigration ---');
    console.log(j(fam.data()?.gamificationMigration ?? null));

    console.log('\n########## STEP 2: gamification_summaries ##########');
    const sum = await db.doc(`families/${fid}/gamification_summaries/${user.id}`).get();
    if (!sum.exists) console.log('MISSING');
    else {
      const s = sum.data();
      console.log(j({ xpTotal: s.xpTotal ?? null, level: s.level ?? null, projectionStatus: s.projectionStatus ?? null, updatedAt: ts(s.updatedAt), all: Object.keys(s).sort() }));
      console.log('FULL:', j(JSON.parse(JSON.stringify(s, (k, v) => (v && v._seconds ? ts(v) : v)))));
    }

    console.log('\n########## STEP 3: gamification_events ##########');
    const ev = await db.collection(`families/${fid}/gamification_events`).where('childId', '==', user.id).get();
    const evs = ev.docs.map(x => ({ id: x.id, ...x.data() }))
      .sort((p, q) => (p.createdAt?._seconds ?? 0) - (q.createdAt?._seconds ?? 0));
    let xpSum = 0, rpSum = 0;
    console.log('count:', evs.length);
    for (const e of evs) {
      xpSum += e.xpDelta ?? 0; rpSum += e.rewardPointsDelta ?? 0;
      console.log([e.id, ts(e.createdAt), e.eventType, 'xpDelta=' + (e.xpDelta ?? 'undef'),
        'rpDelta=' + (e.rewardPointsDelta ?? 'undef'), 'completionId=' + (e.completionId ?? e.sourceId ?? 'n/a')].join(' | '));
    }
    if (evs[0]) console.log('SAMPLE EVENT KEYS:', Object.keys(evs[0]).sort().join(', '));
    console.log('SUM(xpDelta)=', xpSum, ' SUM(rewardPointsDelta)=', rpSum);

    console.log('\n########## STEP 4: approved task_completions ##########');
    const comps = await db.collection(`families/${fid}/task_completions`).where('assigneeId', '==', user.id).get();
    const approved = comps.docs.map(x => ({ id: x.id, ...x.data() }))
      .filter(c => c.status === 'approved')
      .sort((p, q) => (p.approvedAt?._seconds ?? 0) - (q.approvedAt?._seconds ?? 0));
    console.log('total:', comps.size, 'approved:', approved.length);
    let awardSum = 0;
    for (const c of approved) {
      awardSum += (c.awardedPoints ?? c.pointsReward ?? 0);
      console.log([c.id, ts(c.approvedAt), 'task=' + c.taskId, 'pointsReward=' + (c.pointsReward ?? 'undef'),
        'awardedPoints=' + (c.awardedPoints ?? 'undef'), 'gamProcessedAt=' + ts(c.gamificationProcessedAt),
        'xpAwarded=' + (c.xpAwarded ?? 'undef')].join(' | '));
    }
    console.log('SUM(awardedPoints||pointsReward) =', awardSum);
    if (approved[0]) console.log('SAMPLE COMPLETION KEYS:', Object.keys(approved[0]).sort().join(', '));

    console.log('\n########## STEP 6.3: redemption / spend sources ##########');
    for (const coll of ['reward_transactions', 'reward_redemptions', 'redemptions', 'wallet', 'wallets', 'wallet_transactions', 'avatar_unlocks', 'purchases', 'reward_claims', 'rewards']) {
      const s = await safeGet(() => db.collection(`families/${fid}/${coll}`).get(), coll);
      if (!s) continue;
      const mine = s.docs.filter(x => {
        const v = x.data();
        return [v.childId, v.memberId, v.userId, v.assigneeId, v.claimedBy, v.ownerId].includes(user.id);
      });
      console.log(`${coll}: total=${s.size} forMember=${mine.length}`);
      mine.forEach(x => console.log('   ', x.id, j(JSON.parse(JSON.stringify(x.data(), (k, v) => (v && v._seconds ? ts(v) : v))))));
    }
    const userSubs = await user.ref.listCollections();
    console.log('user subcollections:', userSubs.map(c => c.id).join(', ') || '(none)');
    for (const c of userSubs) {
      const s = await c.get();
      console.log(`  users/${user.id}/${c.id}: ${s.size}`);
      s.docs.forEach(x => console.log('    ', x.id, j(JSON.parse(JSON.stringify(x.data(), (k, v) => (v && v._seconds ? ts(v) : v))))));
    }
    const famSubs = await db.doc(`families/${fid}`).listCollections();
    console.log('family subcollections:', famSubs.map(c => c.id).join(', '));
  }
  process.exit(0);
}
main().catch(e => { console.error('ERR', e); process.exit(1); });
