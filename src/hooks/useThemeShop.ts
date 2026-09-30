/**
 * `useThemeShop` — the child-facing Theme Shop hook.
 *
 * Responsibilities (read-mostly; the only writes go through the canonical
 * `purchaseShopTheme` transaction in api.ts):
 *   - Project the theme catalog + family catalog rows + this child's
 *     purchase records into a shop view model.
 *   - Resolve the Theme of the Week: a promoted theme is temporarily
 *     usable WITHOUT granting ownership, and expiry safely restores the
 *     child's previous owned/default theme (see `useExperienceTheme`).
 *
 * Architectural rules
 * -------------------
 *   - Price/active/promo authority comes from the family catalog row when
 *     present, otherwise from the built-in shop defaults (parity with the
 *     `themeCatalogPrice` rules fallback, pinned by unit test).
 *   - No client-side balance mutation, no direct Firestore writes.
 *   - Clock is injectable for deterministic tests (`setThemeShopClock`).
 *   - Unknown rows fail safe: unknown theme ids are dropped, malformed
 *     rows fall back to built-in defaults.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { purchaseShopTheme, type ShopThemeCatalogRow } from '../lib/api';
import {
  DEFAULT_SHOP_PRICES,
  SHOP_THEME_IDS,
  defaultShopThemeId,
  getShopThemeByItemId,
  getThemeById,
  type ThemeDefinition,
} from '../domain/experience';

/* -------------------------------------------------------------------------- */
/* Clock injection (deterministic tests)                                      */
/* -------------------------------------------------------------------------- */

let clock: () => number = () => Date.now();

/** Replace the hook's clock. Returns a disposer restoring the previous one. */
export function setThemeShopClock(override: () => number): () => void {
  const previous = clock;
  clock = override;
  return () => {
    clock = previous;
  };
}

/* -------------------------------------------------------------------------- */
/* View model                                                                 */
/* -------------------------------------------------------------------------- */

export type ShopItemStatus = 'owned' | 'free' | 'purchasable' | 'promo';

export interface ShopItem {
  /** Canonical shop item id. */
  readonly shopItemId: string;
  /** Theme catalog definition rendered by the shop card. */
  readonly theme: ThemeDefinition;
  /** Authoritative price in points (0 when free / currently promoted). */
  readonly pricePoints: number;
  /** Built-in or parent-published price — what the child actually pays. */
  readonly effectivePricePoints: number;
  /** Whether the item can be acquired at all right now. */
  readonly isActive: boolean;
  /** Status of this item for the current child. */
  readonly status: ShopItemStatus;
  /** Theme of the Week bundle when this item is the promoted one. */
  readonly promo: ThemeOfTheWeek | null;
  /** True when the parent disabled theme shopping for the family. */
  readonly shoppingDisabled: boolean;
  /** True when the shop catalog row was parent-published (overriding defaults). */
  readonly hasCatalogRow: boolean;
}

export interface ThemeOfTheWeek {
  /** The promoted theme. */
  readonly theme: ThemeDefinition;
  /** Shop item id the promotion was published against. */
  readonly shopItemId: string;
  /** Inclusive start (epoch ms, authoritative server-written value). */
  readonly startsAt: number;
  /** Exclusive end (epoch ms). */
  readonly endsAt: number;
}

export interface UseThemeShopResult {
  /** Shop cards in display order (Classic is the default, shown first). */
  readonly items: readonly ShopItem[];
  /** Classic theme definition (always owned by every child). */
  readonly classicTheme: ThemeDefinition;
  /** Active Theme of the Week, or null when none is live. */
  readonly themeOfTheWeek: ThemeOfTheWeek | null;
  /** True once the catalog + purchase subscriptions have delivered data. */
  readonly isLoading: boolean;
  /** True when the parent disabled theme shopping for this family. */
  readonly shoppingDisabled: boolean;
  /** In-flight purchase item id (double-tap guard). */
  readonly purchasingItemId: string | null;
  /** Error message from the last failed purchase (child-readable). */
  readonly purchaseError: string | null;
  /** Attempt a purchase through the canonical transaction pipeline. */
  readonly purchase: (shopItemId: string) => Promise<boolean>;
  /** Clear the last purchase error (e.g. on sheet dismiss). */
  readonly clearError: () => void;
}

/* -------------------------------------------------------------------------- */
/* Row normalisation                                                          */
/* -------------------------------------------------------------------------- */

function toMillis(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const v = value as { toMillis?: unknown; toDate?: unknown; seconds?: unknown; nanoseconds?: unknown } | null;
  if (v && typeof v === 'object' && typeof v.toMillis === 'function') return (v.toMillis as () => number)();
  if (v && typeof v === 'object' && typeof v.toDate === 'function') return (v.toDate as () => Date)().getTime();
  if (value instanceof Date) return value.getTime();
  if (v && typeof v === 'object' && typeof v.seconds === 'number') {
    return (v.seconds as number) * 1_000 + (typeof v.nanoseconds === 'number' ? (v.nanoseconds as number) : 0) / 1_000_000;
  }
  return 0;
}

function normaliseRow(raw: any): ShopThemeCatalogRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const shopItemId = typeof raw.shopItemId === 'string' ? raw.shopItemId : raw.id;
  if (typeof shopItemId !== 'string' || shopItemId.length === 0) return null;
  const promo = raw.promo && typeof raw.promo === 'object'
    ? {
      themeId: typeof raw.promo.themeId === 'string' ? raw.promo.themeId : '',
      startsAt: toMillis(raw.promo.startsAt),
      endsAt: toMillis(raw.promo.endsAt),
    }
    : null;
  return {
    shopItemId,
    themeId: typeof raw.themeId === 'string' ? raw.themeId : defaultShopThemeId(shopItemId),
    name: typeof raw.name === 'string' ? raw.name : undefined,
    pricePoints: typeof raw.pricePoints === 'number' && Number.isFinite(raw.pricePoints)
      ? raw.pricePoints
      : (DEFAULT_SHOP_PRICES[shopItemId] ?? 0),
    isActive: raw.isActive !== false,
    featured: raw.featured === true,
    promo: promo && promo.themeId && promo.endsAt > promo.startsAt ? promo : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Hook                                                                       */
/* -------------------------------------------------------------------------- */

export function useThemeShop(): UseThemeShopResult {
  const themeShopItems = useStore((s: any) => s.themeShopItems);
  const themePurchases = useStore((s: any) => s.themePurchases);
  const currentUser = useStore((s: any) => s.currentUser);
  const familyData = useStore((s: any) => s.familyData);
  const [purchasingItemId, setPurchasingItemId] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  // Synchronous in-flight guard. The state mirror drives the disabled UI;
  // the ref drives the guard itself so two rapid taps can never both pass
  // (a state-only check races against React batching).
  const purchasingRef = useRef(false);

  const familyId: string = familyData?.id ?? currentUser?.familyId ?? '';
  const childId: string = currentUser?.id ?? currentUser?.uid ?? '';

  const shoppingDisabled = useMemo(() => {
    const engagement = familyData?.engagementPreferences as Record<string, unknown> | undefined;
    return engagement?.themeShoppingEnabled === false;
  }, [familyData]);

  // The shop renders built-in defaults even before the catalog subscription
  // delivers its first snapshot, so a cold start or temporary offline state
  // never flashes an empty shop (spec: offline / reload behaviour).
  const isLoading = !familyId;

  const ownedItemIds = useMemo(() => {
    const owned = new Set<string>();
    if (!Array.isArray(themePurchases) || !childId) return owned;
    for (const doc of themePurchases) {
      // Defence-in-depth: a purchase record only counts when it belongs to
      // THIS child. The production query already filters by child (the mirror
      // lives at families/{id}/users/{childId}/theme_purchases/{shopItemId},
      // so the doc id IS the shop item id), but a mis-projected client cache
      // must never grant another child's ownership.
      const docChild = typeof doc?.childId === 'string' ? doc.childId : null;
      const docId = typeof doc?.id === 'string' ? doc.id : null;
      const docItemId = typeof doc?.shopItemId === 'string' ? doc.shopItemId : docId;
      const mine =
        docChild === childId ||
        // Per-child mirror shape: keyed by shop item id (no childId field —
        // the parent collection path carries the child scope).
        (docChild == null && typeof doc?.shopItemId === 'string') ||
        // Legacy canonical shape: keyed by childId.
        (docChild == null && docId === childId);
      if (!mine) continue;
      if (typeof docItemId === 'string' && docItemId !== childId) owned.add(docItemId);
    }
    return owned;
  }, [themePurchases, childId]);

  const rowsById = useMemo(() => {
    const map = new Map<string, ShopThemeCatalogRow>();
    if (Array.isArray(themeShopItems)) {
      for (const raw of themeShopItems) {
        const row = normaliseRow(raw);
        if (row) map.set(row.shopItemId, row);
      }
    }
    return map;
  }, [themeShopItems]);

  const now = clock();

  // Theme of the Week: the first live promotion across catalog rows.
  const themeOfTheWeek = useMemo<ThemeOfTheWeek | null>(() => {
    for (const row of rowsById.values()) {
      if (!row.promo) continue;
      if (row.promo.themeId !== row.themeId) continue;
      if (now < row.promo.startsAt || now >= row.promo.endsAt) continue;
      const theme = getThemeById(row.promo.themeId);
      if (!theme) continue;
      return Object.freeze({
        theme,
        shopItemId: row.shopItemId,
        startsAt: row.promo.startsAt,
        endsAt: row.promo.endsAt,
      }) as ThemeOfTheWeek;
    }
    return null;
  }, [rowsById, now]);

  const items = useMemo<ShopItem[]>(() => {
    const shopItems: ShopItem[] = SHOP_THEME_IDS
      .map((shopItemId): ShopItem | null => {
        const theme = getShopThemeByItemId(shopItemId);
        if (!theme) return null;
        const row = rowsById.get(shopItemId);
        const builtInPrice = DEFAULT_SHOP_PRICES[shopItemId] ?? 0;
        const pricePoints = row?.pricePoints ?? builtInPrice;
        const isActive = row ? row.isActive : true;
        const owned = ownedItemIds.has(shopItemId);
        const isPromo =
          themeOfTheWeek?.shopItemId === shopItemId && themeOfTheWeek.theme.id === theme.id;
        const status: ShopItemStatus = owned
          ? 'owned'
          : isPromo
            ? 'promo'
            : isActive && pricePoints > 0
              ? 'purchasable'
              : 'free';
        return Object.freeze({
          shopItemId,
          theme,
          pricePoints,
          effectivePricePoints: isPromo ? 0 : pricePoints,
          isActive,
          status,
          promo: isPromo ? themeOfTheWeek : null,
          shoppingDisabled,
          hasCatalogRow: row != null,
        }) as ShopItem;
      })
      .filter((item): item is ShopItem => item != null);
    return Object.freeze(shopItems) as ShopItem[];
  }, [rowsById, ownedItemIds, themeOfTheWeek, shoppingDisabled]);

  const purchase = useCallback(
    async (shopItemId: string): Promise<boolean> => {
      // Double-tap guard: the ref is checked-and-set synchronously so a
      // second click inside the same frame can never start a second
      // transaction. (The transaction's idempotency ledger is the second,
      // authoritative line of defence.)
      if (!familyId || purchasingRef.current) return false;
      purchasingRef.current = true;
      setPurchaseError(null);
      setPurchasingItemId(shopItemId);
      try {
        await purchaseShopTheme(familyId, shopItemId);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Purchase failed';
        // Surface child-friendly copy; keep raw codes out of the UI.
        setPurchaseError(message.includes('more points') ? message : 'Purchase could not be completed.');
        return false;
      } finally {
        purchasingRef.current = false;
        setPurchasingItemId(null);
      }
    },
    [familyId],
  );

  const clearError = useCallback(() => setPurchaseError(null), []);

  return {
    items,
    classicTheme: getThemeById('theme.standard')!,
    themeOfTheWeek,
    isLoading,
    shoppingDisabled,
    purchasingItemId,
    purchaseError,
    purchase,
    clearError,
  };
}
