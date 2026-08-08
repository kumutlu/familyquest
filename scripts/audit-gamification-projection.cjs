#!/usr/bin/env node
/**
 * READ-ONLY production audit for the Phase 2 (family challenge XP) precondition.
 *
 * Verifies that every child member of every family has a ready gamification
 * summary at families/{familyId}/gamification_summaries/{memberId}, and compares
 * legacy Σ users.lifetimeXP against authoritative Σ summaries.xpTotal for every
 * active family challenge.
 *
 * This script performs NO writes.
 */
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const keyPath =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  './familyquest-beta-402cb-firebase-adminsdk-fbsvc-a99bd8d895.json';

initializeApp({ credential: cert(require(path.resolve(keyPath))) });
const db = getFirestore();

const isReady = (s) =>
  !!s &&
  s.rebuildRequired !== true &&
  s.projectionStatus !== 'rebuilding' &&
  Number.isFinite(Number(s.xpTotal)) &&
  Number.isFinite(Number(s.level));

(async () => {
  const report = {
    familiesScanned: 0,
    childMembersScanned: 0,
    readySummaries: 0,
    missingSummaries: [],
    rebuildingSummaries: [],
    malformedSummaries: [],
    activeChallenges: [],
  };

  const families = await db.collection('families').get();
  report.familiesScanned = families.size;

  for (const fam of families.docs) {
    const familyId = fam.id;
    const members = await db.collection('users').where('familyId', '==', familyId).get();
    const children = members.docs.filter((d) => (d.data().role || '') === 'child');

    const summaries = await db.collection(`families/${familyId}/gamification_summaries`).get();
    const byId = new Map(summaries.docs.map((d) => [d.id, d.data()]));

    let legacySum = 0;
    let authoritativeSum = 0;

    for (const child of children) {
      report.childMembersScanned += 1;
      legacySum += Number(child.data().lifetimeXP || 0);
      const s = byId.get(child.id);
      if (!s) {
        report.missingSummaries.push({ familyId, memberId: child.id });
        continue;
      }
      if (s.rebuildRequired === true || s.projectionStatus === 'rebuilding') {
        report.rebuildingSummaries.push({ familyId, memberId: child.id, status: s.projectionStatus, rebuildRequired: !!s.rebuildRequired });
        continue;
      }
      if (!isReady(s)) {
        report.malformedSummaries.push({ familyId, memberId: child.id, xpTotal: s.xpTotal, level: s.level });
        continue;
      }
      report.readySummaries += 1;
      authoritativeSum += Number(s.xpTotal || 0);
    }

    const challenges = await db.collection(`families/${familyId}/challenges`).get().catch(() => ({ docs: [] }));
    for (const ch of challenges.docs) {
      const c = ch.data();
      const active = c.status === 'active' || c.status === 'in_progress' || c.isActive === true;
      if (!active) continue;
      report.activeChallenges.push({
        familyId,
        challengeId: ch.id,
        status: c.status ?? (c.isActive ? 'isActive:true' : 'unknown'),
        storedStartXP: c.startXP ?? null,
        legacySumLifetimeXP: legacySum,
        authoritativeSumXpTotal: authoritativeSum,
        drift: (c.startXP ?? 0) - authoritativeSum,
      });
    }
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error('AUDIT_FAILED:', e.message);
  process.exit(1);
});
