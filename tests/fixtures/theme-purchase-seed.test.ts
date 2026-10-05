/**
 * FIXTURE REGRESSION GUARD — theme-visual ownership seed.
 *
 * The screenshot fixture used to write only the CANONICAL purchase record.
 * The client's ownership projection is hydrated from the per-child MIRROR
 * collection (`families/{familyId}/users/{childId}/theme_purchases`), because
 * a collection-group read of the canonical records cannot satisfy
 * rules-are-not-filters scoping. The result was a self-contradictory
 * screenshot fixture: the transaction answered "You already own this theme"
 * (canonical record present) while the shop offered "Buy" (mirror empty).
 *
 * These tests pin the seeded shape to the three things it must agree with:
 *   1. `firestore.rules` — the mirror's allowed key set.
 *   2. `src/lib/bootstrapQueries.ts` — the collection the client reads.
 *   3. `src/domain/experience` — the compiled-in prices/theme ids the seed
 *      claims to own.
 *
 * Pure and emulator-free: the ownership shape lives in
 * `tests/e2e/utils/themePurchaseSeedShape.ts` (imported by the seed itself),
 * so this guard needs no Firebase runtime.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import {
  seededThemePurchaseDocuments,
  THEME_PURCHASE_MIRROR_COLLECTION,
  THEME_PURCHASE_MIRROR_KEYS,
} from '../e2e/utils/themePurchaseSeedShape';
import { DEFAULT_SHOP_PRICES, defaultShopThemeId } from '../../src/domain/experience';

const REPO = resolve(__dirname, '../..');
const RULES = readFileSync(resolve(REPO, 'firestore.rules'), 'utf8');
const BOOTSTRAP_QUERIES = readFileSync(resolve(REPO, 'src/lib/bootstrapQueries.ts'), 'utf8');

const SAMPLE = {
  familyId: 'fam-x',
  childId: 'child-x',
  shopItemId: 'neon',
  themeId: 'theme.shop.neon',
  costPoints: 500,
  purchasedAt: { seconds: 1, nanoseconds: 0 },
} as const;

describe('theme purchase seed fixture shape', () => {
  const { canonical, mirror } = seededThemePurchaseDocuments(SAMPLE);

  it('writes BOTH documents: the canonical authority and the per-child mirror', () => {
    // Canonical — immutable, keyed by child id, read by the purchase
    // transaction (duplicate detection) and by the equip rule.
    expect(canonical.path).toBe('families/fam-x/themes/neon/purchases/child-x');
    expect(canonical.data).toMatchObject({
      shopItemId: 'neon',
      childId: 'child-x',
      familyId: 'fam-x',
      themeId: 'theme.shop.neon',
      costPoints: 500,
      source: 'points',
      actorId: 'child-x',
    });

    // Mirror — the ONLY collection the client's bootstrap query reads.
    expect(mirror.path).toBe('families/fam-x/users/child-x/theme_purchases/neon');
    expect(mirror.data).toMatchObject({
      shopItemId: 'neon',
      themeId: 'theme.shop.neon',
      costPoints: 500,
    });

    // Either document alone produces the old broken fixture, so both are
    // asserted as a single contract.
    expect([canonical.path, mirror.path]).toHaveLength(2);
  });

  it('writes the mirror with EXACTLY the keys firestore.rules allows', () => {
    const allowed = RULES.match(/function allowedMirrorKeys\(\)\s*\{\s*return \[([^\]]+)\]/);
    expect(allowed, 'firestore.rules must still define allowedMirrorKeys()').not.toBeNull();
    const allowedKeys = (allowed![1].match(/'([^']+)'/g) ?? []).map((k) => k.replace(/'/g, ''));
    expect(allowedKeys).toEqual([...THEME_PURCHASE_MIRROR_KEYS]);
    expect(Object.keys(mirror.data).sort()).toEqual([...THEME_PURCHASE_MIRROR_KEYS].sort());
  });

  it('writes a mirror the client ownership projection recognises', () => {
    // `useThemeShop` / `useChildThemeRights` accept a record when it has a
    // `shopItemId` and NO `childId` (the parent path carries the child
    // scope). A mirror carrying `childId` would still work, but the rules
    // forbid it — hasOnly would reject the write in production.
    expect(mirror.data).not.toHaveProperty('childId');
    expect(typeof mirror.data.shopItemId).toBe('string');
    // The doc id is the shop item id, which is the key the projection
    // derives the owned item from.
    expect(mirror.path.split('/').pop()).toBe(SAMPLE.shopItemId);
  });

  it('targets the collection the client bootstrap query actually subscribes to', () => {
    expect(THEME_PURCHASE_MIRROR_COLLECTION).toBe('theme_purchases');
    expect(BOOTSTRAP_QUERIES).toContain(THEME_PURCHASE_MIRROR_COLLECTION);
    expect(BOOTSTRAP_QUERIES).toMatch(/users\/\$\{userId\}\/theme_purchases/);
    // The rules comment names the same mirror path.
    expect(RULES).toContain(`users/{childId}/${THEME_PURCHASE_MIRROR_COLLECTION}`);
  });

  it('prices the seeded ownership at the authoritative compiled-in prices', () => {
    for (const shopItemId of Object.keys(DEFAULT_SHOP_PRICES)) {
      const docs = seededThemePurchaseDocuments({
        ...SAMPLE,
        shopItemId,
        themeId: defaultShopThemeId(shopItemId),
        costPoints: DEFAULT_SHOP_PRICES[shopItemId],
      });
      expect(docs.canonical.data.costPoints).toBe(DEFAULT_SHOP_PRICES[shopItemId]);
      expect(docs.mirror.data.themeId).toBe(defaultShopThemeId(shopItemId));
      expect(docs.canonical.path).toBe(`families/fam-x/themes/${shopItemId}/purchases/child-x`);
      expect(docs.mirror.path).toBe(`families/fam-x/users/child-x/theme_purchases/${shopItemId}`);
    }
  });

  it('leaves the seeded child able to afford BOTH 500-point themes', () => {
    // The fixture owns all five themes, so nothing needs buying; this guards
    // the headroom that keeps a future purchase-path fallback possible.
    const seededBalance = 1200; // seed-theme-visuals.ts → users/child1
    expect(seededBalance).toBeGreaterThanOrEqual(
      DEFAULT_SHOP_PRICES.neon + DEFAULT_SHOP_PRICES.space,
    );
  });
});