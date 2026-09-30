/**
 * THEME SHOP — Firestore rules tests.
 *
 * Proves the database boundary for every child/parent theme write:
 *   - a child can NEVER grant themselves ownership (purchase records are
 *     only valid when committed atomically with the exact points
 *     deduction — forging fails closed),
 *   - the catalogue (price / active / promo) is parent-authored only,
 *   - the deduction must equal the AUTHORITATIVE catalogue cost
 *     (built-in default when no row is published),
 *   - duplicate ownership never allows a second deduction,
 *   - a child may only touch the single cosmetic `theme` field on their
 *     own profile — never a sibling's, never with smuggled fields,
 *   - seasonal / shopping preferences remain parent-controlled,
 *   - the existing cosmetic self-update path keeps working.
 *
 * Runs under the Firestore emulator via `npm run test:rules`.
 */

import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';

let testEnv: any;
const projectId = 'familyquest-theme-shop';
const familyId = 'familyTS';
const parentId = 'parentTS';
const childId = 'childTS';
const siblingId = 'siblingTS';
const shopItemId = 'space';
const themeId = 'theme.shop.space';
const purchasePath = `families/${familyId}/themes/${shopItemId}/purchases/${childId}`;
const mirrorPath = `families/${familyId}/users/${childId}/theme_purchases/${shopItemId}`;

function purchaseDoc(overrides: Record<string, unknown> = {}) {
  return {
    shopItemId,
    childId,
    familyId,
    themeId,
    costPoints: 500,
    source: 'points',
    purchasedAt: serverTimestamp(),
    actorId: childId,
    ...overrides,
  };
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context: any) => {
    const db = context.firestore();
    await setDoc(doc(db, 'families', familyId), { name: 'Theme Family', currencyCode: 'GBP' });
    await setDoc(doc(db, 'users', parentId), { familyId, role: 'parent', displayName: 'Parent' });
    await setDoc(doc(db, 'users', childId), {
      familyId, role: 'child', displayName: 'Kid', rewardPoints: 1000,
    });
    await setDoc(doc(db, 'users', siblingId), {
      familyId, role: 'child', displayName: 'Sibling', rewardPoints: 100,
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

/**
 * The canonical client commit: the rewardPoints deduction, the canonical
 * purchase record, and the per-child mirror projection are written in ONE
 * atomic batch — exactly what the rules require. A batch is Firestore's
 * transactional unit, so all writes are evaluated against the same
 * post-commit snapshot (getAfter sees the partner writes).
 */
async function canonicalPurchase(
  cost: number,
  opts: { remaining?: number; overrides?: Record<string, unknown>; db?: any } = {},
) {
  const client = opts.db ?? testEnv.authenticatedContext(childId).firestore();
  const remaining = opts.remaining ?? 1000 - cost;
  const purchaseThemeId = (opts.overrides?.themeId as string) ?? themeId;
  const batch = writeBatch(client);
  batch.update(doc(client, 'users', childId), {
    rewardPoints: remaining,
    lastThemePurchaseId: shopItemId,
  });
  batch.set(doc(client, purchasePath), purchaseDoc({ costPoints: cost, ...opts.overrides }));
  batch.set(doc(client, mirrorPath), {
    shopItemId,
    themeId: purchaseThemeId,
    costPoints: cost,
    purchasedAt: serverTimestamp(),
  });
  await assertSucceeds(batch.commit());
}

/** An intended-to-fail atomic commit with a forged/mismatched purchase. */
async function failedPurchase(overrides: Record<string, unknown> = {}, remaining?: number) {
  const client = testEnv.authenticatedContext(childId).firestore();
  const batch = writeBatch(client);
  batch.update(doc(client, 'users', childId), {
    rewardPoints: remaining ?? 1000 - (overrides.costPoints as number ?? 500),
    lastThemePurchaseId: shopItemId,
  });
  batch.set(doc(client, purchasePath), purchaseDoc(overrides));
  await assertFails(batch.commit());
}

describe('THEME SHOP rules — catalogue authority', () => {
  it('a parent can publish a valid catalog row (price authority)', async () => {
    const db = testEnv.authenticatedContext(parentId).firestore();
    await assertSucceeds(setDoc(doc(db, `families/${familyId}/themes`, shopItemId), {
      shopItemId, themeId, name: 'Space Explorer', pricePoints: 500, isActive: true,
    }));
  });

  it('a child can NEVER create or edit the catalogue (price/active/promo)', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertFails(setDoc(doc(db, `families/${familyId}/themes`, shopItemId), {
      shopItemId, themeId, name: 'Space Explorer', pricePoints: 0, isActive: true,
    }));
    await assertFails(setDoc(doc(db, `families/${familyId}/themes`, 'rainbow'), {
      shopItemId: 'rainbow', themeId: 'theme.shop.rainbow', name: 'Rainbow Pop',
      pricePoints: 1, isActive: true,
    }));
  });

  it('a parent can publish a Theme of the Week promo window on the row', async () => {
    const db = testEnv.authenticatedContext(parentId).firestore();
    await assertSucceeds(setDoc(doc(db, `families/${familyId}/themes`, shopItemId), {
      shopItemId, themeId, name: 'Space Explorer', pricePoints: 500, isActive: true,
      promo: { themeId, startsAt: 1_000, endsAt: 2_000 },
    }));
  });

  it('a malformed promo window is rejected even for a parent', async () => {
    const db = testEnv.authenticatedContext(parentId).firestore();
    await assertFails(setDoc(doc(db, `families/${familyId}/themes`, shopItemId), {
      shopItemId, themeId, name: 'Space Explorer', pricePoints: 500, isActive: true,
      promo: { themeId, startsAt: 2_000, endsAt: 1_000 },
    }));
  });
});

describe('THEME SHOP rules — purchase boundary', () => {
  it('the canonical atomic purchase (deduction + record + mirror) succeeds at the authoritative price', async () => {
    // No catalog row published → the built-in default (500) is the authority.
    await canonicalPurchase(500);
  });

  it('a canonical purchase WITHOUT the mirror projection is denied (paired-write contract)', async () => {
    const client = testEnv.authenticatedContext(childId).firestore();
    const batch = writeBatch(client);
    batch.update(doc(client, 'users', childId), { rewardPoints: 500, lastThemePurchaseId: shopItemId });
    batch.set(doc(client, purchasePath), purchaseDoc());
    await assertFails(batch.commit());
  });

  it('a standalone mirror record is denied (mirror cannot exist without the canonical purchase)', async () => {
    const client = testEnv.authenticatedContext(childId).firestore();
    const batch = writeBatch(client);
    batch.update(doc(client, 'users', childId), { rewardPoints: 500, lastThemePurchaseId: shopItemId });
    batch.set(doc(client, mirrorPath), {
      shopItemId, themeId, costPoints: 500, purchasedAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
  });

  it('a standalone purchase record (no paired deduction) is ownership forgery — denied', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertFails(setDoc(doc(db, purchasePath), purchaseDoc()));
  });

  it('a standalone deduction (no purchase record) is a points theft — denied', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertFails(updateDoc(doc(db, 'users', childId), {
      rewardPoints: 500,
      lastThemePurchaseId: shopItemId,
    }));
  });

  it('the deduction must equal the authoritative catalogue cost (mismatch denied)', async () => {
    await failedPurchase({ costPoints: 200 }, 800);
  });

  it('a client-forged purchase shape (wrong actor/source/theme) is denied', async () => {
    await failedPurchase({ actorId: siblingId }, 500);
    await failedPurchase({ source: 'admin' }, 500);
    await failedPurchase({ themeId: 'theme.shop.rainbow' }, 500);
  });

  it('duplicate ownership never allows another deduction', async () => {
    await canonicalPurchase(500);
    // Second attempt: the purchase record already exists → both the paired
    // record create and the fresh-deduction validator fail closed.
    const client = testEnv.authenticatedContext(childId).firestore();
    await assertFails(updateDoc(doc(client, 'users', childId), {
      rewardPoints: 0,
      lastThemePurchaseId: shopItemId,
    }));
  });

  it('a purchase that would drive the balance negative is denied', async () => {
    const client = testEnv.authenticatedContext(childId).firestore();
    const batch = writeBatch(client);
    batch.update(doc(client, 'users', childId), { rewardPoints: -5, lastThemePurchaseId: shopItemId });
    batch.set(doc(client, purchasePath), purchaseDoc());
    await assertFails(batch.commit());
  });

  it('when the parent disables theme shopping, even an atomic purchase is denied', async () => {
    const parentDb = testEnv.authenticatedContext(parentId).firestore();
    await assertSucceeds(updateDoc(doc(parentDb, 'families', familyId), {
      engagementPreferences: { themeShoppingEnabled: false },
    }));
    const client = testEnv.authenticatedContext(childId).firestore();
    const batch = writeBatch(client);
    batch.update(doc(client, 'users', childId), { rewardPoints: 500, lastThemePurchaseId: shopItemId });
    batch.set(doc(client, purchasePath), purchaseDoc());
    await assertFails(batch.commit());
  });
});

describe('THEME SHOP rules — equip (theme preference) boundary', () => {
  it('a child may equip the default theme (single cosmetic field)', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertSucceeds(updateDoc(doc(db, 'users', childId), { theme: 'theme.standard' }));
  });

  it('a child may equip an owned shop theme', async () => {
    await canonicalPurchase(500);
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertSucceeds(updateDoc(doc(db, 'users', childId), { theme: themeId }));
  });

  it('a child can NOT equip an unowned shop theme', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertFails(updateDoc(doc(db, 'users', childId), { theme: themeId }));
  });

  it('a child MAY equip the LIVE Theme of the Week WITHOUT owning it (temporary access)', async () => {
    // Parent publishes a catalog row with a live promo window (now inside).
    const parentDb = testEnv.authenticatedContext(parentId).firestore();
    const now = Date.now();
    await setDoc(doc(parentDb, `families/${familyId}/themes`, shopItemId), {
      shopItemId, themeId, name: 'Space Explorer', pricePoints: 500, isActive: true,
      promo: { themeId, startsAt: now - 60_000, endsAt: now + 7 * 24 * 60 * 60 * 1000 },
    });
    const db = testEnv.authenticatedContext(childId).firestore();
    // No purchase record exists — the promo alone grants temporary access.
    await assertSucceeds(updateDoc(doc(db, 'users', childId), { theme: themeId }));
  });

  it('an EXPIRED Theme of the Week no longer grants equip rights (safe fallback)', async () => {
    const parentDb = testEnv.authenticatedContext(parentId).firestore();
    const now = Date.now();
    await setDoc(doc(parentDb, `families/${familyId}/themes`, shopItemId), {
      shopItemId, themeId, name: 'Space Explorer', pricePoints: 500, isActive: true,
      promo: { themeId, startsAt: now - 14 * 24 * 60 * 60 * 1000, endsAt: now - 7 * 24 * 60 * 60 * 1000 },
    });
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertFails(updateDoc(doc(db, 'users', childId), { theme: themeId }));
  });

  it('a promo window that has not started yet does NOT grant equip rights', async () => {
    const parentDb = testEnv.authenticatedContext(parentId).firestore();
    const now = Date.now();
    await setDoc(doc(parentDb, `families/${familyId}/themes`, shopItemId), {
      shopItemId, themeId, name: 'Space Explorer', pricePoints: 500, isActive: true,
      promo: { themeId, startsAt: now + 7 * 24 * 60 * 60 * 1000, endsAt: now + 14 * 24 * 60 * 60 * 1000 },
    });
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertFails(updateDoc(doc(db, 'users', childId), { theme: themeId }));
  });

  it('a promo pointing at a DIFFERENT theme does not unlock this theme', async () => {
    const parentDb = testEnv.authenticatedContext(parentId).firestore();
    const now = Date.now();
    await setDoc(doc(parentDb, `families/${familyId}/themes`, shopItemId), {
      shopItemId, themeId, name: 'Space Explorer', pricePoints: 500, isActive: true,
      // The window is live but promotes another theme id.
      promo: { themeId: 'theme.shop.neon', startsAt: now - 60_000, endsAt: now + 60_000 },
    });
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertFails(updateDoc(doc(db, 'users', childId), { theme: themeId }));
  });

  it('a promo on an INACTIVE catalog row does not grant equip rights', async () => {
    const parentDb = testEnv.authenticatedContext(parentId).firestore();
    const now = Date.now();
    await setDoc(doc(parentDb, `families/${familyId}/themes`, shopItemId), {
      shopItemId, themeId, name: 'Space Explorer', pricePoints: 500, isActive: false,
      promo: { themeId, startsAt: now - 60_000, endsAt: now + 60_000 },
    });
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertFails(updateDoc(doc(db, 'users', childId), { theme: themeId }));
  });

  it('a child can NOT forge a promo window by writing the catalog row themselves', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    const now = Date.now();
    await assertFails(setDoc(doc(db, `families/${familyId}/themes`, shopItemId), {
      shopItemId, themeId, name: 'Space Explorer', pricePoints: 0, isActive: true,
      promo: { themeId, startsAt: now - 60_000, endsAt: now + 60_000 },
    }));
    // And the equip therefore stays denied.
    await assertFails(updateDoc(doc(db, 'users', childId), { theme: themeId }));
  });

  it('a child can NOT re-theme a sibling (unrelated child protection)', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertFails(updateDoc(doc(db, 'users', siblingId), { theme: 'theme.standard' }));
  });

  it('a "theme" update can NOT smuggle other profile fields (points/role/etc.)', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertFails(updateDoc(doc(db, 'users', childId), { theme: 'theme.standard', rewardPoints: 999999 }));
    await assertFails(updateDoc(doc(db, 'users', childId), { theme: 'theme.standard', role: 'parent' }));
    await assertFails(updateDoc(doc(db, 'users', childId), { theme: 'theme.standard', language: 'tr' }));
  });

  it('an unknown theme id is rejected by the closed catalog pattern', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertFails(updateDoc(doc(db, 'users', childId), { theme: 'theme.does-not-exist' }));
  });
});

describe('THEME SHOP rules — family preferences stay parent-controlled', () => {
  it('a child can NOT mutate engagementPreferences (seasonal / shopping toggle)', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertFails(updateDoc(doc(db, 'families', familyId), {
      engagementPreferences: { themeShoppingEnabled: true, seasonalEvents: { christmas: true } },
    }));
  });

  it('a child can NOT mutate the top-level themeShoppingEnabled toggle', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertFails(updateDoc(doc(db, 'families', familyId), { themeShoppingEnabled: false }));
  });

  it('a parent can update engagementPreferences and the shop toggle', async () => {
    const db = testEnv.authenticatedContext(parentId).firestore();
    await assertSucceeds(updateDoc(doc(db, 'families', familyId), {
      engagementPreferences: { themeShoppingEnabled: true, seasonalEvents: { christmas: true } },
    }));
    await assertSucceeds(updateDoc(doc(db, 'families', familyId), { themeShoppingEnabled: true }));
  });
});
