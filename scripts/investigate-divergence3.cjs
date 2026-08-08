/** READ-ONLY: full behaviour event docs + feed entries for child. */
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const svc = require('./../firebase-key.json');
initializeApp({ credential: cert(svc), projectId: 'familyquest-beta-402cb' });
const db = getFirestore();
const FID = '5s4Npeu55wPphLCsGAMP';
const CID = 'vc0iyHVfAcXnXQQbmFkr5HfJEkp2';
const S = (o) => JSON.stringify(o, (k, v) => (v && v._seconds ? new Date(v._seconds * 1000).toISOString() : v), 2);
async function main() {
  const bev = await db.collection(`families/${FID}/behaviour_events`).get();
  for (const d of bev.docs.filter(x => x.data().childId === CID)) {
    console.log('--- behaviour_event', d.id, '---');
    console.log(S(d.data()));
  }
  console.log('\n=== FEED (child, points-related, last 40) ===');
  const feed = await db.collection(`families/${FID}/feed`).get();
  feed.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(f => JSON.stringify(f).includes(CID))
    .sort((a, b) => (a.createdAt?._seconds ?? 0) - (b.createdAt?._seconds ?? 0))
    .slice(-40)
    .forEach(f => console.log(f.id, f.createdAt?._seconds ? new Date(f.createdAt._seconds * 1000).toISOString() : '', f.type, 'points=' + (f.points ?? f.pointsDelta ?? ''), 'xp=' + (f.xp ?? f.xpDelta ?? ''), (f.title || f.message || '').slice(0, 60)));
  process.exit(0);
}
main().catch(e => { console.error('ERR', e); process.exit(1); });
