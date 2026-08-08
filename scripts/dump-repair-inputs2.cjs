#!/usr/bin/env node
/**
 * READ-ONLY exploration of the family collections needed for the Stage B
 * repair simulation. Performs NO writes.
 */
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './firebase-key.json';
initializeApp({ credential: cert(require(path.resolve(keyPath))) });
const db = getFirestore();

const FAMILY = '5s4Npeu55wPphLCsGAMP';

(async () => {
  const out = {};
  const familyRef = db.doc(`families/${FAMILY}`);

  const cols = await familyRef.listCollections();
  out.collections = cols.map((c) => c.id);

  out.members = (await db.collection('users').where('familyId', '==', FAMILY).get()).docs
    .map((d) => ({ id: d.id, name: d.data().displayName ?? d.data().name, role: d.data().role,
      rewardPoints: d.data().rewardPoints, lifetimeXP: d.data().lifetimeXP }));

  const counts = {};
  for (const c of cols) counts[c.id] = (await c.get()).size;
  out.counts = counts;

  out.behaviourEvent = await familyRef.collection('behaviour_events').doc('SXkg6R4vxWTJowdJXdLA').get()
    .then((s) => (s.exists ? s.data() : null));

  out.completion = await familyRef.collection('task_completions')
    .doc('vc0iyHVfAcXnXQQbmFkr5HfJEkp2__c3WmeyXGkvhwVe7mWTiq__2026-08-03').get()
    .then((s) => (s.exists ? s.data() : null));

  out.completionSample = (await familyRef.collection('task_completions').limit(3).get()).docs
    .map((d) => ({ id: d.id, data: d.data() }));

  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})().catch((e) => { console.error('DUMP2_FAILED:', e.message); process.exit(1); });
