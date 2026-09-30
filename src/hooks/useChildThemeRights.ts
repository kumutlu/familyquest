/**
 * `useChildThemeRights` — the ONE bridge between the app store and the
 * pure experience-theme engine.
 *
 * Architecture gate: `useExperienceTheme` must stay free of firebase /
 * zustand imports (pinned by `src/domain/experience/resolver.test.ts`).
 * This module owns every impure input that shapes the equipped slot:
 *
 *   1. The child's persisted profile theme (`currentUser.theme`, written
 *      through `updateChildTheme` after apply / buy-and-apply).
 *   2. A localStorage mirror (`queki:equipped-theme`) so reloads and PWA
 *      relaunches render the right world immediately, before the profile
 *      listener round-trips Firestore.
 *   3. The child's immutable theme purchases (ownership).
 *   4. The live Theme of the Week promotion (temporary access WITHOUT
 *      ownership — expiry falls back safely to the previous valid theme).
 *
 * Equip rights (mirrors the Firestore rules):
 *   - `theme.standard` is always allowed (the default).
 *   - Non-shop catalog themes (seasonal / weekly content) are free
 *     experiences — pinning one is a cosmetic choice, never an unlock.
 *   - Shop themes (`theme.shop.*`) require an OWNED purchase record for
 *     THIS child, or the live Theme of the Week promotion.
 *   - Anything else resolves to `null` → the equipped slot is cleared and
 *     the resolver falls back (seasonal → weekly → base). An expired
 *     promotion NEVER leaves the child themeless and NEVER mints
 *     ownership.
 *
 * The engine keeps the resolver precedence; this file only decides
 * whether the equipped slot may hold a theme at all. It writes through
 * the engine's `setEquippedCustomisation` seam so the engine stays pure.
 */

import { useEffect, useMemo } from 'react';
import { useStore } from '../store/useStore';
import {
  getThemeById,
  type EquippedCustomisation,
} from '../domain/experience';

/**
 * How the bridge writes the equipped slot. Supplied by the engine
 * (`setEquippedCustomisation`) so the two modules never form an import
 * cycle: the engine imports this file; this file never imports the
 * engine.
 */
export type ApplyEquippedCustomisation = (next: EquippedCustomisation) => void;

/* -------------------------------------------------------------------------- */
/* localStorage mirror (offline / reload fallback)                            */
/* -------------------------------------------------------------------------- */

/**
 * localStorage key prefix mirroring the child's last known-good equipped
 * theme. The key is SCOPED per family AND per child
 * (`<prefix>:<familyId>:<childId>`) so a shared device can never leak one
 * child's cached theme into another child's first paint.
 *
 * The legacy GLOBAL key (`queki:equipped-theme`, pre-isolation releases) is
 * migrated once into the scoped slot and then removed — see
 * `migrateLegacyEquippedTheme`.
 */
const EQUIPPED_THEME_STORAGE_KEY_PREFIX = 'queki:equipped-theme';
const LEGACY_EQUIPPED_THEME_STORAGE_KEY = 'queki:equipped-theme';

/** Scoped key for one child in one family. Both ids are required. */
function equippedThemeStorageKey(familyId: string, childId: string): string {
  return `${EQUIPPED_THEME_STORAGE_KEY_PREFIX}:${familyId}:${childId}`;
}

/**
 * Read the stored mirror for THIS family + child. Returns `null` when
 * storage is unavailable (private mode, quota errors), the scope ids are
 * missing, or the value is absent — callers treat the mirror as a hint,
 * never as authority.
 */
export function getStoredEquippedTheme(familyId: string, childId: string): string | null {
  if (!familyId || !childId) return null;
  try {
    const raw = window.localStorage.getItem(equippedThemeStorageKey(familyId, childId));
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Persist (or clear) the mirror for THIS family + child. Best-effort:
 * failures are swallowed so a storage error can never break equipping.
 * Calls without a full scope are ignored — the mirror is never written to
 * a shared/global slot.
 */
export function storeEquippedTheme(
  themeId: string | null,
  familyId: string,
  childId: string,
): void {
  if (!familyId || !childId) return;
  try {
    const key = equippedThemeStorageKey(familyId, childId);
    if (themeId) {
      window.localStorage.setItem(key, themeId);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Storage unavailable — the mirror is an optimisation, not a record.
  }
}

/**
 * One-time migration of the LEGACY global key (pre-isolation releases
 * stored one device-wide value). When the scoped slot is empty:
 *   1. Read the legacy global value (if any).
 *   2. Copy a non-empty value into THIS child's scoped slot (the rights
 *      check still gates it — an unowned value equips nothing).
 *   3. ALWAYS remove the legacy key so the migration runs at most once
 *      per device and later children can never inherit it.
 *
 * Returns the migrated theme id, or `null` when there was nothing (or no
 * longer anything) to migrate. Idempotent and self-limiting.
 */
export function migrateLegacyEquippedTheme(familyId: string, childId: string): string | null {
  if (!familyId || !childId) return null;
  try {
    const legacy = window.localStorage.getItem(LEGACY_EQUIPPED_THEME_STORAGE_KEY);
    // Remove unconditionally: even when the legacy slot is empty or holds
    // an unusable value, it must never leak to the NEXT child on a shared
    // device.
    window.localStorage.removeItem(LEGACY_EQUIPPED_THEME_STORAGE_KEY);
    if (typeof legacy === 'string' && legacy.length > 0) {
      storeEquippedTheme(legacy, familyId, childId);
      return legacy;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The mirror must name a REAL catalog theme or it is ignored — a stale
 * or tampered value can never equip an unknown id (the resolver would
 * fall back anyway, but rejecting here keeps the equipped slot honest).
 */
function safeEquippedThemeId(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return getThemeById(raw) ? raw : null;
}

/* -------------------------------------------------------------------------- */
/* Store projections                                                          */
/* -------------------------------------------------------------------------- */

function toMillis(value: any): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value?.seconds === 'number') {
    return value.seconds * 1_000 + (value.nanoseconds ?? 0) / 1_000_000;
  }
  return 0;
}

/**
 * Shop item ids owned by THIS child. Mirrors `useThemeShop`'s ownership
 * projection exactly: a purchase record only counts when it belongs to
 * the current child (`doc.childId === childId`, or the doc is keyed by
 * the childId itself), and a malformed record whose item id collapsed
 * to the child's own id is never treated as an item.
 */
function ownedItemIds(themePurchases: unknown, childId: string): Set<string> {
  const owned = new Set<string>();
  if (!Array.isArray(themePurchases) || !childId) return owned;
  for (const doc of themePurchases) {
    const docChild = typeof doc?.childId === 'string' ? doc.childId : null;
    const docId = typeof doc?.id === 'string' ? doc.id : null;
    const docItemId = typeof doc?.shopItemId === 'string' ? doc.shopItemId : docId;
    const mine =
      docChild === childId ||
      // Per-child mirror shape: keyed by shop item id (no childId field —
      // the parent collection path carries the child scope; the bootstrap
      // query is already scoped to THIS child).
      (docChild == null && typeof doc?.shopItemId === 'string') ||
      // Legacy canonical shape: keyed by childId.
      (docChild == null && docId === childId);
    if (!mine) continue;
    if (typeof docItemId === 'string' && docItemId !== childId) owned.add(docItemId);
  }
  return owned;
}

/**
 * The live Theme of the Week theme id, or `null`. Mirrors
 * `useThemeShop`: a promotion only counts when it promotes the row's own
 * theme and the authoritative window (server-written startsAt/endsAt)
 * contains `now`. End is exclusive so expiry is exact.
 */
function livePromoThemeId(themeShopItems: unknown, now: number): string | null {
  if (!Array.isArray(themeShopItems)) return null;
  for (const raw of themeShopItems) {
    const promo = raw?.promo;
    if (!promo || typeof promo !== 'object') continue;
    const promoThemeId = typeof promo.themeId === 'string' ? promo.themeId : '';
    const rowThemeId = typeof raw.themeId === 'string' ? raw.themeId : '';
    if (!promoThemeId || promoThemeId !== rowThemeId) continue;
    const startsAt = toMillis(promo.startsAt);
    const endsAt = toMillis(promo.endsAt);
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) continue;
    if (endsAt <= startsAt) continue;
    if (now < startsAt || now >= endsAt) continue;
    return promoThemeId;
  }
  return null;
}

/**
 * May the equipped slot hold `themeId` for this child RIGHT NOW?
 * Pure over its inputs — the store projections above are the only
 * impurity boundary.
 */
function hasEquippedRights(
  themeId: string,
  owned: Set<string>,
  promoThemeId: string | null,
): boolean {
  if (themeId === 'theme.standard') return true; // Default — always allowed.
  const theme = getThemeById(themeId);
  if (!theme) return false; // Unknown ids never equip.
  const shopItemId = theme.shopItemId;
  if (!shopItemId) return true; // Non-shop catalog theme (seasonal/weekly content).
  return owned.has(shopItemId) || promoThemeId === theme.id;
}

/**
 * Resolve the id the equipped slot may hold: the child's persisted
 * profile theme first, the localStorage mirror as offline fallback.
 * The first candidate that passes the rights check wins; when neither
 * is usable the answer is `null` and the resolver falls back safely.
 */
function resolveEquippedThemeId(
  profileTheme: unknown,
  storedTheme: string | null,
  owned: Set<string>,
  promoThemeId: string | null,
): string | null {
  const candidates = [
    safeEquippedThemeId(profileTheme),
    safeEquippedThemeId(storedTheme),
  ];
  for (const candidate of candidates) {
    if (candidate && hasEquippedRights(candidate, owned, promoThemeId)) {
      return candidate;
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Bridge hook                                                                */
/* -------------------------------------------------------------------------- */

const EMPTY_EQUIPPED: EquippedCustomisation = Object.freeze({});

/**
 * Theme id the bridge last applied to the engine. Cleared ONLY when the
 * bridge itself set it, so tests (and future surfaces) that drive the
 * engine seam directly keep their state — the bridge never clobbers an
 * equipped slot it did not write.
 */
let lastAppliedThemeId: string | null = null;

/** Number of mounted bridge consumers (multiple components may run the hook). */
let activeBridges = 0;

/**
 * Apply the child's equip rights to the pure engine.
 *
 * `now` is the engine's injected clock value (epoch ms) so promo-window
 * evaluation is deterministic under `setExperienceClock`.
 *
 * Returns the equipped customisation the engine should hold (stable
 * identity across renders; the engine merges it above its own seam
 * state).
 */
export function useChildThemeRights(
  now: number,
  apply: ApplyEquippedCustomisation,
): EquippedCustomisation {
  const currentUser = useStore((s: any) => s.currentUser);
  const themePurchases = useStore((s: any) => s.themePurchases);
  const themeShopItems = useStore((s: any) => s.themeShopItems);

  const profileTheme = currentUser?.theme;
  const childId: string = currentUser?.id ?? currentUser?.uid ?? '';
  const familyId: string = currentUser?.familyId ?? '';

  const candidate = useMemo(() => {
    const owned = ownedItemIds(themePurchases, childId);
    const promo = livePromoThemeId(themeShopItems, now);
    // One-time legacy migration, then read the scoped slot. A legacy value
    // migrates into THIS child's slot and the global key is removed, so a
    // shared device can never hand the value to the next child.
    migrateLegacyEquippedTheme(familyId, childId);
    const stored = getStoredEquippedTheme(familyId, childId);
    return resolveEquippedThemeId(profileTheme, stored, owned, promo);
  }, [profileTheme, childId, familyId, themePurchases, themeShopItems, now]);

  useEffect(() => {
    if (candidate) {
      apply({ themeId: candidate });
      lastAppliedThemeId = candidate;
      storeEquippedTheme(candidate, familyId, childId);
      return;
    }
    // No right to equip anything: clear only what the bridge itself
    // applied. An expired promotion or a revoked theme falls back to
    // the resolver's seasonal → weekly → base chain.
    if (lastAppliedThemeId !== null) {
      apply(EMPTY_EQUIPPED);
      lastAppliedThemeId = null;
    }
    // Mirror maintenance on the no-rights path: an equip that expired or was
    // revoked must not survive in THIS child's scoped slot, or the next
    // offline reload would re-offer it (the rights check would still reject
    // it — this keeps the mirror honest). Clearing is scoped family+child.
    storeEquippedTheme(null, familyId, childId);
  }, [candidate, apply, familyId, childId]);

  useEffect(() => {
    activeBridges += 1;
    return () => {
      activeBridges -= 1;
      // Last bridge unmounting (sign-out, account switch): drop the
      // equipped slot so the next child's first paint can never render
      // the previous child's theme.
      if (activeBridges === 0 && lastAppliedThemeId !== null) {
        apply(EMPTY_EQUIPPED);
        lastAppliedThemeId = null;
      }
    };
  }, [apply]);

  // Stable identity so the engine's resolution memo does not recompute
  // every render — only when the rights outcome actually changes.
  const equippedValue = useMemo<EquippedCustomisation>(
    () => (candidate ? ({ themeId: candidate } as EquippedCustomisation) : EMPTY_EQUIPPED),
    [candidate],
  );
  return equippedValue;
}
