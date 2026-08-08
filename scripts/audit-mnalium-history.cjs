/**
 * READ-ONLY historical audit of every approved task completion for one member.
 * Performs NO writes and proposes NO repair. Output is evidence + classification.
 *
 * Usage: node scripts/audit-mnalium-history.cjs [memberName] [--json]
 */
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const svc = require('./../firebase-key.json');

initializeApp({ credential: cert(svc), projectId: svc.project_id || 'familyquest-beta-402cb' });
const db = getFirestore();

const NAME = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'Mnalium';
const AS_JSON = process.argv.includes('--json');

const ms = v => {
  if (!v) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v._seconds === 'number') return v._seconds * 1000;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  return null;
};
const iso = v => (ms(v) === null ? null : new Date(ms(v)).toISOString());

async function findMembers() {
  const seen = new Map();
  for (const field of ['name', 'displayName']) {
    const snap = await db.collection('users').where(field, '==', NAME).get();
    snap.docs.forEach(d => seen.set(d.id, d));
  }
  return [...seen.values()];
}

async function auditMember(user) {
  const u = user.data();
  const familyId = u.familyId;
  const familyDoc = await db.doc(`families/${familyId}`).get();
  const migration = (familyDoc.exists && familyDoc.data().gamificationMigration) || {};
  const cutoverAt = ms(migration.cutoverAt);
  const summaryDoc = await db.doc(`families/${familyId}/gamification_summaries/${user.id}`).get();

  const completionsSnap = await db.collection(`families/${familyId}/task_completions`)
    .where('assigneeId', '==', user.id).get();

  // Shared-task completions do not always carry assigneeId; also scan by completedBy/childId.
  const extra = new Map();
  for (const field of ['completedBy', 'childId', 'memberId']) {
    try {
      const s = await db.collection(`families/${familyId}/task_completions`).where(field, '==', user.id).get();
      s.docs.forEach(d => extra.set(d.id, d));
    } catch (_) { /* field may not be indexed/exist */ }
  }
  completionsSnap.docs.forEach(d => extra.set(d.id, d));

  const approved = [...extra.values()]
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(c => c.status === 'approved')
    .sort((a, b) => (ms(a.approvedAt) ?? 0) - (ms(b.approvedAt) ?? 0));

  // Events, keyed by completion where possible.
  const eventsSnap = await db.collection(`families/${familyId}/gamification_events`)
    .where('childId', '==', user.id).get();
  const events = eventsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const eventsByCompletion = new Map();
  events.forEach(e => {
    const key = e.completionId || e.sourceId || e.effectId || null;
    if (key) eventsByCompletion.set(key, e);
  });

  // Ledger / task lookups.
  const taskCache = new Map();
  const getTask = async id => {
    if (!id) return null;
    if (!taskCache.has(id)) {
      const d = await db.doc(`families/${familyId}/tasks/${id}`).get();
      taskCache.set(id, d.exists ? d.data() : null);
    }
    return taskCache.get(id);
  };

  // Derive processor-version eras from observed data (no hard-coded guesses).
  const processedRows = approved
    .filter(c => ms(c.gamificationProcessedAt) !== null)
    .map(c => ({ at: ms(c.gamificationProcessedAt), version: c.gamificationProcessorVersion || c.processorVersion || null }));
  const firstProcessedAt = processedRows.length ? Math.min(...processedRows.map(r => r.at)) : null;
  const sharedTaskFixAt = Math.min(
    ...processedRows
      .filter(r => typeof r.version === 'string' && r.version.includes('shared-tasks'))
      .map(r => r.at),
    Infinity,
  );

  const rows = [];
  for (const c of approved) {
    const task = await getTask(c.taskId);
    const approvedMs = ms(c.approvedAt);
    const hasEffectSnapshot = c.gamificationEffectSnapshot !== undefined || c.effectSnapshot !== undefined;
    const processed = ms(c.gamificationProcessedAt) !== null;
    const processorStarted = processed
      || c.gamificationProcessingStartedAt !== undefined
      || c.gamificationStatus !== undefined
      || c.gamificationError !== undefined;
    const event = eventsByCompletion.get(c.id) || null;
    const preCutover = cutoverAt !== null && approvedMs !== null && approvedMs < cutoverAt;
    const sharedTask = !c.assigneeId || (task && !task.assigneeId);
    const isBehaviour = c.sourceType === 'behaviour' || c.behaviourId !== undefined;

    let classification;
    let reason;
    if (hasEffectSnapshot || event || c.awardedPoints !== undefined) {
      classification = 'already awarded';
      reason = event ? 'gamification event exists' : (hasEffectSnapshot ? 'effectSnapshot present' : 'awardedPoints recorded');
    } else if (preCutover) {
      classification = 'ignored by migration';
      reason = `approvedAt ${iso(c.approvedAt)} < cutoverAt ${new Date(cutoverAt).toISOString()}`;
    } else if (sharedTask && sharedTaskFixAt !== Infinity && approvedMs < sharedTaskFixAt) {
      classification = 'shared-task bug';
      reason = 'task had no assigneeId and predates shared-task processor fix';
    } else if (sharedTask) {
      classification = 'shared-task bug';
      reason = 'task had no assigneeId; processor skipped award';
    } else if (isBehaviour) {
      classification = 'behaviour bug';
      reason = 'behaviour-sourced completion, no award artefacts';
    } else if (processorStarted && !processed) {
      classification = 'processor failed';
      reason = c.gamificationError ? String(c.gamificationError) : 'processor started but never wrote processedAt';
    } else if (!processorStarted) {
      classification = 'processor failed';
      reason = 'no processor markers at all (never triggered)';
    } else {
      classification = 'unknown';
      reason = 'processed but no award artefacts';
    }

    rows.push({
      approvedAt: iso(c.approvedAt),
      completionId: c.id,
      taskId: c.taskId ?? null,
      taskTitle: task ? (task.title ?? null) : null,
      taskAssigneeId: task ? (task.assigneeId ?? null) : null,
      completionAssigneeId: c.assigneeId ?? null,
      points: c.awardedPoints ?? (task ? task.pointsReward ?? null : null),
      hasEffectSnapshot,
      processorStarted,
      gamificationProcessedAt: iso(c.gamificationProcessedAt),
      processorVersion: c.gamificationProcessorVersion || c.processorVersion || null,
      gamificationError: c.gamificationError ?? null,
      preCutover,
      sharedTask: Boolean(sharedTask),
      eventId: event ? event.id : null,
      xpDelta: event ? (event.xpDelta ?? null) : null,
      classification,
      reason,
    });
  }

  return {
    member: {
      id: user.id,
      name: u.displayName || u.name || null,
      familyId,
      createdAt: iso(u.createdAt),
      rewardPoints: u.rewardPoints ?? null,
      lifetimeXP: u.lifetimeXP ?? null,
    },
    migration: {
      status: migration.status ?? null,
      cutoverAt: cutoverAt === null ? null : new Date(cutoverAt).toISOString(),
      baselineSource: summaryDoc.exists ? (summaryDoc.data().baselineSource ?? null) : null,
      summaryXpTotal: summaryDoc.exists ? (summaryDoc.data().xpTotal ?? null) : null,
    },
    derivedEras: {
      firstProcessedAt: firstProcessedAt === null ? null : new Date(firstProcessedAt).toISOString(),
      sharedTaskFixAt: sharedTaskFixAt === Infinity ? null : new Date(sharedTaskFixAt).toISOString(),
    },
    eventTotals: { count: events.length, xpSum: events.reduce((s, e) => s + (e.xpDelta ?? 0), 0) },
    approvedCount: rows.length,
    rows,
  };
}

function printTable(result) {
  console.log(`\n=== MEMBER ${result.member.name} (${result.member.id}) family ${result.member.familyId} ===`);
  console.log('created:', result.member.createdAt, '| rewardPoints:', result.member.rewardPoints, '| lifetimeXP:', result.member.lifetimeXP);
  console.log('migration:', JSON.stringify(result.migration));
  console.log('derived eras:', JSON.stringify(result.derivedEras));
  console.log('events:', JSON.stringify(result.eventTotals));
  console.log(`approved completions: ${result.approvedCount}\n`);
  const header = ['#', 'approvedAt', 'completionId', 'task', 'pts', 'snap', 'procStarted', 'processedAt', 'preCutover', 'shared', 'classification', 'reason'];
  console.log(header.join(' | '));
  result.rows.forEach((r, i) => {
    console.log([
      i + 1, r.approvedAt, r.completionId, r.taskTitle || r.taskId, r.points,
      r.hasEffectSnapshot ? 'yes' : 'no', r.processorStarted ? 'yes' : 'no',
      r.gamificationProcessedAt || '-', r.preCutover ? 'yes' : 'no', r.sharedTask ? 'yes' : 'no',
      r.classification, r.reason,
    ].join(' | '));
  });
  const counts = result.rows.reduce((a, r) => ({ ...a, [r.classification]: (a[r.classification] || 0) + 1 }), {});
  console.log('\ntotals:', JSON.stringify(counts));
}

async function main() {
  const members = await findMembers();
  if (!members.length) { console.log(`No user found with name/displayName == ${NAME}`); process.exit(0); }
  const results = [];
  for (const m of members) results.push(await auditMember(m));
  if (AS_JSON) console.log(JSON.stringify({ mode: 'READ_ONLY', results }, null, 2));
  else results.forEach(printTable);
  process.exit(0);
}

main().catch(e => { console.error('ERR', e); process.exit(1); });
