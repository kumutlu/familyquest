#!/usr/bin/env node
/** READ-ONLY. Dumps Alisya + Mnalium completions, events, eligibility, progress, tasks. NO writes. */
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './firebase-key.json';
initializeApp({ credential: cert(require(path.resolve(keyPath))) });
const db = getFirestore();

const FAMILY = '5s4Npeu55wPphLCsGAMP';
const ALISYA = 'NuyIJDP9fDNP2LiKynlsEyzur5N2';
const MNALIUM = 'vc0iyHVfAcXnXQQbmFkr5HfJEkp2';
const ts = (v) => (v && v._seconds !== undefined ? new Date(v._seconds * 1000).toISOString() : v ?? null);

(async () => {
  const familyRef = db.doc(`families/${FAMILY}`);
  const [completions, events, elig, progress, tasks, occurrences] = await Promise.all([
    familyRef.collection('task_completions').get(),
    familyRef.collection('gamification_events').get(),
    familyRef.collection('daily_eligibility').get(),
    familyRef.collection('daily_progress').get(),
    familyRef.collection('tasks').get(),
    familyRef.collection('task_occurrences').get(),
  ]);

  const taskById = new Map(tasks.docs.map((d) => [d.id, d.data()]));

  const rows = completions.docs
    .filter((d) => [ALISYA, MNALIUM].includes(d.data().assigneeId))
    .map((d) => {
      const c = d.data();
      const t = taskById.get(c.taskId) || {};
      return {
        id: d.id,
        child: c.assigneeId === ALISYA ? 'Alisya' : 'Mnalium',
        taskId: c.taskId,
        taskTitle: t.title ?? t.name ?? null,
        taskPoints: t.pointsReward ?? t.points ?? null,
        periodKey: c.periodKey ?? null,
        status: c.status,
        awardedPoints: c.awardedPoints ?? null,
        hasEffectSnapshot: !!c.effectSnapshot,
        effectSnapshot: c.effectSnapshot ?? null,
        completedAt: ts(c.completedAt),
        approvedAt: ts(c.approvedAt),
      };
    })
    .sort((a, b) => String(a.approvedAt).localeCompare(String(b.approvedAt)));

  console.log(JSON.stringify({
    completions: rows,
    events: events.docs.map((d) => ({ id: d.id, childId: d.data().childId, type: d.data().eventType,
      xpDelta: d.data().xpDelta, dayKey: d.data().dayKey ?? null, effectiveAt: ts(d.data().effectiveAt) })),
    eligibility: elig.docs.map((d) => ({ id: d.id, ...d.data(), effectiveAt: ts(d.data().effectiveAt), createdAt: ts(d.data().createdAt) })),
    progress: progress.docs.map((d) => ({ id: d.id, ...d.data(), calculatedAt: ts(d.data().calculatedAt) })),
    occurrences: occurrences.docs.map((d) => ({ id: d.id, ...d.data() })),
    tasks: tasks.docs.map((d) => ({ id: d.id, title: d.data().title ?? d.data().name,
      points: d.data().pointsReward ?? d.data().points, assigneeIds: d.data().assigneeIds ?? d.data().assigneeId ?? null,
      recurrence: d.data().recurrence ?? null, archived: d.data().archived ?? d.data().isArchived ?? null })),
  }, null, 1));
  process.exit(0);
})().catch((e) => { console.error('DUMP3_FAILED:', e.message); process.exit(1); });
