import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';

const FAMILY_ID = 'checkin-family';
const OTHER_FAMILY_ID = 'other-family';
const LOCAL_DATE = '2026-08-01';
const DOCUMENT_ID = `child_${LOCAL_DATE}`;
let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'familyquest-daily-checkins-rules',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, `families/${FAMILY_ID}`), {
      name: 'Check-in family',
      dailyCheckins: { childrenEnabled: true, historyVisibleToParents: true },
    });
    await setDoc(doc(db, `families/${OTHER_FAMILY_ID}`), { name: 'Other family' });
    await setDoc(doc(db, 'users/owner'), { familyId: FAMILY_ID, role: 'owner' });
    await setDoc(doc(db, 'users/parent'), { familyId: FAMILY_ID, role: 'parent' });
    await setDoc(doc(db, 'users/child'), { familyId: FAMILY_ID, role: 'child' });
    await setDoc(doc(db, 'users/sibling'), { familyId: FAMILY_ID, role: 'child' });
    await setDoc(doc(db, 'users/outsider'), { familyId: OTHER_FAMILY_ID, role: 'parent' });
    await setDoc(doc(db, 'users/former'), { familyId: OTHER_FAMILY_ID, role: 'child' });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

const dbFor = (uid: string) => testEnv.authenticatedContext(uid).firestore();
const checkinPath = (documentId = DOCUMENT_ID, familyId = FAMILY_ID) =>
  `families/${familyId}/daily_checkins/${documentId}`;
const skipPath = (documentId = DOCUMENT_ID, familyId = FAMILY_ID) =>
  `families/${familyId}/daily_checkin_skips/${documentId}`;

const checkinData = (overrides: Record<string, unknown> = {}) => ({
  familyId: FAMILY_ID,
  userId: 'child',
  localDate: LOCAL_DATE,
  animal: 'cheetah',
  catalogVersion: 1,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...overrides,
});

const skipData = (overrides: Record<string, unknown> = {}) => ({
  familyId: FAMILY_ID,
  userId: 'child',
  localDate: LOCAL_DATE,
  createdAt: serverTimestamp(),
  ...overrides,
});

async function seedCheckin(overrides: Record<string, unknown> = {}, documentId = DOCUMENT_ID) {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), checkinPath(documentId)), {
      ...checkinData({
        createdAt: new Date('2026-08-01T08:00:00Z'),
        updatedAt: new Date('2026-08-01T08:00:00Z'),
      }),
      ...overrides,
    });
  });
}

async function seedSkip(overrides: Record<string, unknown> = {}, documentId = DOCUMENT_ID) {
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), skipPath(documentId)), {
      ...skipData({ createdAt: new Date('2026-08-01T08:00:00Z') }),
      ...overrides,
    });
  });
}

async function setParentHistoryVisibility(enabled: boolean) {
  await testEnv.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), `families/${FAMILY_ID}`), {
      dailyCheckins: { childrenEnabled: true, historyVisibleToParents: enabled },
    });
  });
}

describe('daily check-in records', () => {
  it.each([
    ['child', 'child'],
    ['parent', 'parent'],
    ['owner', 'owner'],
  ] as const)('allows %s members to create and read their own V1 check-in', async (actor, userId) => {
    const db = dbFor(actor);
    const documentId = `${userId}_${LOCAL_DATE}`;
    const ref = doc(db, checkinPath(documentId));

    await expect(assertSucceeds(setDoc(ref, checkinData({ userId })))).resolves.toBeUndefined();
    await expect(assertSucceeds(getDoc(ref))).resolves.toBeDefined();
  });

  it('allows same-family parents to read a child check-in when history is enabled', async () => {
    await seedCheckin();

    await expect(assertSucceeds(getDoc(doc(dbFor('parent'), checkinPath())))).resolves.toBeDefined();
    await expect(assertSucceeds(getDoc(doc(dbFor('owner'), checkinPath())))).resolves.toBeDefined();
  });

  it('allows enabled parents to run the bounded history collection query', async () => {
    await seedCheckin();
    const historyQuery = query(
      collection(dbFor('parent'), `families/${FAMILY_ID}/daily_checkins`),
      orderBy('createdAt', 'desc'),
      limit(100),
    );

    await expect(assertSucceeds(getDocs(historyQuery))).resolves.toBeDefined();
  });

  it('denies parent history when disabled while preserving the child self-read', async () => {
    await seedCheckin();
    await setParentHistoryVisibility(false);

    await expect(assertFails(getDoc(doc(dbFor('parent'), checkinPath())))).resolves.toBeDefined();
    await expect(assertFails(getDoc(doc(dbFor('owner'), checkinPath())))).resolves.toBeDefined();
    await expect(assertSucceeds(getDoc(doc(dbFor('child'), checkinPath())))).resolves.toBeDefined();
  });

  it('denies the parent history collection query when history is disabled', async () => {
    await seedCheckin();
    await setParentHistoryVisibility(false);
    const historyQuery = query(
      collection(dbFor('parent'), `families/${FAMILY_ID}/daily_checkins`),
      orderBy('createdAt', 'desc'),
      limit(100),
    );

    await expect(assertFails(getDocs(historyQuery))).resolves.toBeDefined();
  });

  it('denies self-reads after the user leaves the family', async () => {
    await seedCheckin({ userId: 'former' }, `former_${LOCAL_DATE}`);

    await expect(assertFails(getDoc(doc(
      dbFor('former'),
      checkinPath(`former_${LOCAL_DATE}`),
    )))).resolves.toBeDefined();
  });

  it('denies self-reads while the family is deleting', async () => {
    await seedCheckin();
    await testEnv.withSecurityRulesDisabled(async context => {
      await updateDoc(doc(context.firestore(), `families/${FAMILY_ID}`), {
        lifecycleState: 'deleting',
      });
    });

    await expect(assertFails(getDoc(doc(dbFor('child'), checkinPath())))).resolves.toBeDefined();
  });

  it('denies sibling and cross-family reads and writes', async () => {
    await seedCheckin();

    await expect(assertFails(getDoc(doc(dbFor('sibling'), checkinPath())))).resolves.toBeDefined();
    await expect(assertFails(getDoc(doc(dbFor('outsider'), checkinPath())))).resolves.toBeDefined();
    await expect(assertFails(setDoc(
      doc(dbFor('outsider'), checkinPath(`outsider_${LOCAL_DATE}`)),
      checkinData({ familyId: FAMILY_ID, userId: 'outsider' }),
    ))).resolves.toBeDefined();
    await expect(assertFails(setDoc(
      doc(dbFor('child'), checkinPath(`sibling_${LOCAL_DATE}`)),
      checkinData({ userId: 'sibling' }),
    ))).resolves.toBeDefined();
  });

  it.each([
    ['unsupported animal', DOCUMENT_ID, checkinData({ animal: 'dragon' })],
    ['unsupported catalog version', DOCUMENT_ID, checkinData({ catalogVersion: 2 })],
    ['wrong deterministic id', 'wrong-id', checkinData()],
    ['malformed local date', 'child_01-08-2026', checkinData({ localDate: '01-08-2026' })],
    ['mismatched local date', DOCUMENT_ID, checkinData({ localDate: '2026-08-02' })],
    ['foreign user id', `sibling_${LOCAL_DATE}`, checkinData({ userId: 'sibling' })],
    ['wrong embedded family id', DOCUMENT_ID, checkinData({ familyId: OTHER_FAMILY_ID })],
    ['extra field', DOCUMENT_ID, checkinData({ note: 'private note' })],
    ['non-request-time createdAt', DOCUMENT_ID, checkinData({ createdAt: new Date('2026-08-01T00:00:00Z') })],
    ['non-request-time updatedAt', DOCUMENT_ID, checkinData({ updatedAt: new Date('2026-08-01T00:00:00Z') })],
  ])('rejects %s', async (_caseName, documentId, data) => {
    await expect(assertFails(setDoc(doc(dbFor('child'), checkinPath(documentId)), data))).resolves.toBeDefined();
  });

  it('rejects a missing catalogVersion', async () => {
    const { catalogVersion: _catalogVersion, ...withoutCatalogVersion } = checkinData();

    await expect(assertFails(setDoc(
      doc(dbFor('child'), checkinPath()),
      withoutCatalogVersion,
    ))).resolves.toBeDefined();
  });

  it('keeps check-ins immutable', async () => {
    await seedCheckin();
    const ref = doc(dbFor('child'), checkinPath());

    await expect(assertFails(updateDoc(ref, {
      animal: 'lion',
      updatedAt: serverTimestamp(),
    }))).resolves.toBeDefined();
    await expect(assertFails(deleteDoc(ref))).resolves.toBeDefined();
  });
});

describe('daily check-in skips', () => {
  it('allows a member to create and read only their own exact skip', async () => {
    const ref = doc(dbFor('child'), skipPath());

    await expect(assertSucceeds(setDoc(ref, skipData()))).resolves.toBeUndefined();
    await expect(assertSucceeds(getDoc(ref))).resolves.toBeDefined();
    await expect(assertFails(getDoc(doc(dbFor('parent'), skipPath())))).resolves.toBeDefined();
    await expect(assertFails(getDoc(doc(dbFor('sibling'), skipPath())))).resolves.toBeDefined();
    await expect(assertFails(getDoc(doc(dbFor('outsider'), skipPath())))).resolves.toBeDefined();
  });

  it.each([
    ['wrong deterministic id', 'wrong-id', skipData()],
    ['malformed local date', 'child_01-08-2026', skipData({ localDate: '01-08-2026' })],
    ['mismatched local date', DOCUMENT_ID, skipData({ localDate: '2026-08-02' })],
    ['foreign user id', `sibling_${LOCAL_DATE}`, skipData({ userId: 'sibling' })],
    ['wrong embedded family id', DOCUMENT_ID, skipData({ familyId: OTHER_FAMILY_ID })],
    ['extra field', DOCUMENT_ID, skipData({ reason: 'later' })],
    ['non-request-time createdAt', DOCUMENT_ID, skipData({ createdAt: new Date('2026-08-01T00:00:00Z') })],
  ])('rejects %s', async (_caseName, documentId, data) => {
    await expect(assertFails(setDoc(doc(dbFor('child'), skipPath(documentId)), data))).resolves.toBeDefined();
  });

  it('rejects updates and deletion when no corresponding check-in exists', async () => {
    await seedSkip();
    const ref = doc(dbFor('child'), skipPath());

    await expect(assertFails(updateDoc(ref, { createdAt: serverTimestamp() }))).resolves.toBeDefined();
    await expect(assertFails(deleteDoc(ref))).resolves.toBeDefined();
  });

  it('rejects skip creation when the corresponding check-in already exists', async () => {
    await seedCheckin();

    await expect(assertFails(setDoc(doc(dbFor('child'), skipPath()), skipData()))).resolves.toBeDefined();
  });

  it('rejects creating a skip and check-in for the same day in one batch', async () => {
    const db = dbFor('child');
    const batch = writeBatch(db);
    batch.set(doc(db, checkinPath()), checkinData());
    batch.set(doc(db, skipPath()), skipData());

    await expect(assertFails(batch.commit())).resolves.toBeDefined();
  });

  it('allows atomic check-in creation and deletion of the corresponding skip', async () => {
    await seedSkip();
    const db = dbFor('child');
    const batch = writeBatch(db);
    batch.set(doc(db, checkinPath()), checkinData());
    batch.delete(doc(db, skipPath()));

    await expect(assertSucceeds(batch.commit())).resolves.toBeUndefined();
  });

  it('allows cleanup of an inconsistent skip when the corresponding check-in already exists', async () => {
    await seedCheckin();
    await seedSkip();

    await expect(assertSucceeds(deleteDoc(doc(dbFor('child'), skipPath())))).resolves.toBeUndefined();
  });
});
