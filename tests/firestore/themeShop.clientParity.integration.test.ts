/**
 * Integration test: the Theme Shop PURCHASE PATH against the Firestore
 * emulator with the DEPLOYED rules.
 *
 * Why this file exists
 * --------------------
 * The live production bug was "Purchase could not be completed." for a theme
 * the UI happily offered at 500 pts. The unit tests passed because their
 * fixture always contained a `families/{familyId}/themes/{shopItemId}`
 * catalogue row — a row that NOTHING in the product ever publishes (only the
 * E2E seed and the rules suite create one). Every real family therefore has an
 * EMPTY catalogue, so the row-dependent client check refused a purchase the
 * rules would have committed.
 *
 * This test closes that gap by exercising the REAL client helper
 * (`purchaseShopTheme` from src/lib/api) against the REAL rules with the REAL
 * production shape:
 *
 *   - no catalogue row published (the default for every family),
 *   - Space Explorer at the compiled-in 500 pts,
 *   - the exact five-write transaction the client performs (points deduction,
 *     canonical immutable purchase, per-child ownership mirror, idempotency
 *     ledger, human-readable feed entry).
 *
 * It is the only test that can prove rules/client AGREEMENT, because it is the
 * only one where the payload is produced by production code and validated by
 * the deployed rules in the same run.
 *
 * Run with: `npm run test:rules`
 */
import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  collection,
} from 'firebase/firestore';
import { connectAuthEmulator, createUserWithEmailAndPassword } from 'firebase/auth';
import { readFileSync } from 'fs';
import { db, auth } from '../../src/lib/firebase';
import { purchaseShopTheme } from '../../src/lib/api';
import { DEFAULT_SHOP_PRICES, defaultShopThemeId } from '../../src/domain/experience';

// Point the app's own Firebase instances at the emulator. Guarded because the
// module-level singleton may already be connected when suites share a process.
try {
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
} catch {
  /* already connected */
}
try {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
} catch {
  /* already connected */
}

let testEnv: RulesTestEnvironment;

/** Unique-per-seed ids so tests never share a family or an auth account. */
let seq = 0;

interface Seeded {
  readonly familyId: string;
  readonly childId: string;
}

/**
 * Seed a family whose child can shop. `catalogueRow: null` is the PRODUCTION
 * shape — no `families/{familyId}/themes/{item}` document at all.
 */
async function seedFamily(opts: {
  rewardPoints: number;
  catalogueRow?: Record<string, unknown> | null;
}): Promise<Seeded> {
  seq += 1;
  const familyId = `fam-theme-parity-${seq}`;
  const cred = await createUserWithEmailAndPassword(auth, `theme-parity-${seq}@test.com`, 'password123');
  const childId = cred.user.uid;

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const fdb = ctx.firestore();
    await fdb.doc(`families/${familyId}`).set({ name: 'Theme Parity Family', currencyCode: 'GBP' });
    await fdb.doc(`users/${childId}`).set({
      familyId,
      role: 'child',
      displayName: 'Kid',
      rewardPoints: opts.rewardPoints,
    });
    if (opts.catalogueRow) {
      await fdb.doc(`families/${familyId}/themes/space`).set(opts.catalogueRow);
    }
  });

  return { familyId, childId };
}

async function pointsOf(childId: string): Promise<number> {
  const snap = await getDoc(doc(db, 'users', childId));
  return snap.data()?.rewardPoints as number;
}

async function documentOrNull(path: string) {
  const snap = await getDoc(doc(db, path));
  return snap.exists() ? snap.data() : null;
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    // MUST match the app's own project id (.env VITE_FIREBASE_PROJECT_ID):
    // the emulator namespaces data per project, so a different id here would
    // make rules-disabled seeding invisible to the client under test.
    projectId: 'familyquest-beta-402cb',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('THEME SHOP purchase — real client helper vs deployed rules', () => {
  it('buys Space Explorer at 500 pts with NO published catalogue row (the live production shape)', async () => {
    const { familyId, childId } = await seedFamily({ rewardPoints: 800, catalogueRow: null });

    const result = await purchaseShopTheme(familyId, 'space');

    // The client must resolve the SAME price + themeId the rules fall back to.
    expect(result).toEqual({
      costPoints: DEFAULT_SHOP_PRICES.space,
      themeId: defaultShopThemeId('space'),
    });
    expect(result.costPoints).toBe(500);

    // 1. Points deducted exactly once.
    expect(await pointsOf(childId)).toBe(300);

    // 2. Canonical immutable purchase record at the rules' canonical path.
    const purchase = await documentOrNull(`families/${familyId}/themes/space/purchases/${childId}`);
    expect(purchase).toMatchObject({
      shopItemId: 'space',
      childId,
      familyId,
      themeId: 'theme.shop.space',
      costPoints: 500,
      source: 'points',
      actorId: childId,
    });

    // 3. Per-child ownership mirror (hydrates the child's owned set).
    const mirror = await documentOrNull(`families/${familyId}/users/${childId}/theme_purchases/space`);
    expect(mirror).toMatchObject({
      shopItemId: 'space',
      themeId: 'theme.shop.space',
      costPoints: 500,
    });

    // 4. Idempotency ledger entry (replay protection).
    const idem = await documentOrNull(`families/${familyId}/idempotency/theme_purchase:${childId}:space`);
    expect(idem).toMatchObject({ operationType: 'theme_purchase', status: 'completed' });

    // 5. Human-readable history entry.
    const feed = await getDocs(collection(db, `families/${familyId}/feed`));
    expect(feed.size).toBe(1);
    expect(feed.docs[0].data().text).toContain('Space Explorer');
    expect(feed.docs[0].data().text).toContain('500 points');
  });

  it('balance 487 / price 500 → refuses with "need 13 more points" and writes nothing', async () => {
    const { familyId, childId } = await seedFamily({ rewardPoints: 487, catalogueRow: null });

    await expect(purchaseShopTheme(familyId, 'space')).rejects.toThrow(/need 13 more points/i);

    // No partial writes: no deduction, no ownership, no ledger entry.
    expect(await pointsOf(childId)).toBe(487);
    expect(await documentOrNull(`families/${familyId}/themes/space/purchases/${childId}`)).toBeNull();
    expect(await documentOrNull(`families/${familyId}/users/${childId}/theme_purchases/space`)).toBeNull();
  });

  it('balance 500 / price 500 → succeeds and leaves exactly 0 points', async () => {
    const { familyId, childId } = await seedFamily({ rewardPoints: 500, catalogueRow: null });

    await expect(purchaseShopTheme(familyId, 'space')).resolves.toMatchObject({ costPoints: 500 });
    expect(await pointsOf(childId)).toBe(0);
  });

  it('balance 501 / price 500 → succeeds and leaves exactly 1 point', async () => {
    const { familyId, childId } = await seedFamily({ rewardPoints: 501, catalogueRow: null });

    await expect(purchaseShopTheme(familyId, 'space')).resolves.toMatchObject({ costPoints: 500 });
    expect(await pointsOf(childId)).toBe(1);
  });

  it('a parent-published catalogue row still overrides the built-in price', async () => {
    const { familyId, childId } = await seedFamily({
      rewardPoints: 800,
      catalogueRow: {
        shopItemId: 'space',
        themeId: 'theme.shop.space',
        name: 'Space Explorer',
        pricePoints: 250,
        isActive: true,
      },
    });

    await expect(purchaseShopTheme(familyId, 'space')).resolves.toMatchObject({
      costPoints: 250,
      themeId: 'theme.shop.space',
    });
    expect(await pointsOf(childId)).toBe(550);
  });

  it('a parent-disabled shop refuses the purchase at the rules boundary', async () => {
    const { familyId, childId } = await seedFamily({ rewardPoints: 800, catalogueRow: null });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`families/${familyId}`).update({
        engagementPreferences: { themeShoppingEnabled: false },
      });
    });

    await expect(purchaseShopTheme(familyId, 'space')).rejects.toThrow(/turned off/i);
    expect(await pointsOf(childId)).toBe(800);
  });

  it('replaying the same request id never charges twice', async () => {
    const { familyId, childId } = await seedFamily({ rewardPoints: 800, catalogueRow: null });

    const first = await purchaseShopTheme(familyId, 'space', 'req-parity-1');
    expect(first.costPoints).toBe(500);
    expect(await pointsOf(childId)).toBe(300);

    const replay = await purchaseShopTheme(familyId, 'space', 'req-parity-1');
    expect(replay.costPoints).toBe(0);
    expect(await pointsOf(childId)).toBe(300);
  });

  it('every compiled-in shop item is purchasable with no catalogue row', async () => {
    for (const shopItemId of ['neon', 'space', 'rainbow', 'pixel', 'calm'] as const) {
      const { familyId, childId } = await seedFamily({ rewardPoints: 1000, catalogueRow: null });

      const result = await purchaseShopTheme(familyId, shopItemId);

      expect(result.costPoints).toBe(DEFAULT_SHOP_PRICES[shopItemId]);
      expect(result.themeId).toBe(defaultShopThemeId(shopItemId));
      expect(await pointsOf(childId)).toBe(1000 - DEFAULT_SHOP_PRICES[shopItemId]);
      expect(
        await documentOrNull(`families/${familyId}/users/${childId}/theme_purchases/${shopItemId}`),
      ).not.toBeNull();
    }
  });
});
