/**
 * The EXACT ownership document shape a theme purchase produces, extracted
 * from the E2E seed so it can be unit-tested without an emulator.
 *
 * Why this module exists: the theme-visual screenshot fixture used to write
 * only the canonical purchase record. The client's ownership projection is
 * hydrated from the per-child mirror collection instead (see
 * `createBootstrapQueryPlan` → `themePurchases` and the comment in
 * `firestore.rules` on why a collection-group read is impossible), so the
 * shop showed "Buy" while the transaction correctly answered "You already own
 * this theme". Seeding half the shape is what caused it.
 *
 * `tests/fixtures/theme-purchase-seed.test.ts` pins this shape against
 * `firestore.rules` (the allowed mirror key set) and against the production
 * write paths, so a future fixture edit cannot silently drift again.
 */

/** Families/firestore: the mirror collection the client bootstrap reads. */
export const THEME_PURCHASE_MIRROR_COLLECTION = 'theme_purchases';

/**
 * The mirror field set, in the order the production transaction writes it.
 * Mirrors `allowedMirrorKeys()` in `firestore.rules`; the rules test in
 * `tests/firestore/themeShop.rules.test.ts` refuses any other key.
 */
export const THEME_PURCHASE_MIRROR_KEYS = [
  'shopItemId',
  'themeId',
  'costPoints',
  'purchasedAt',
] as const;

export interface ThemePurchaseSeedInput {
  readonly familyId: string;
  readonly childId: string;
  readonly shopItemId: string;
  readonly themeId: string;
  readonly costPoints: number;
  readonly purchasedAt: unknown;
}

export interface SeededDocument {
  readonly path: string;
  readonly data: Record<string, unknown>;
}

/**
 * The two documents a purchase writes, atomically, in one commit.
 *
 * - `canonical` — immutable authority under
 *   `families/{familyId}/themes/{shopItemId}/purchases/{childId}`; keyed by
 *   CHILD id and carries `childId`, so the client's legacy projection branch
 *   also recognises it.
 * - `mirror` — per-child hydration projection under
 *   `families/{familyId}/users/{childId}/theme_purchases/{shopItemId}`; keyed
 *   by SHOP ITEM id and deliberately has NO `childId` field (the parent path
 *   carries the scope, and the rules' `hasOnly` forbids extra keys).
 */
export function seededThemePurchaseDocuments(
  input: ThemePurchaseSeedInput,
): { canonical: SeededDocument; mirror: SeededDocument } {
  const { familyId, childId, shopItemId, themeId, costPoints, purchasedAt } = input;
  return {
    canonical: {
      path: `families/${familyId}/themes/${shopItemId}/purchases/${childId}`,
      data: {
        shopItemId,
        childId,
        familyId,
        themeId,
        costPoints,
        source: 'points',
        actorId: childId,
        purchasedAt,
      },
    },
    mirror: {
      path: `families/${familyId}/users/${childId}/${THEME_PURCHASE_MIRROR_COLLECTION}/${shopItemId}`,
      data: { shopItemId, themeId, costPoints, purchasedAt },
    },
  };
}