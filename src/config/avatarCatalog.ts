/**
 * Central, curated avatar catalog for FamilyQuest.
 *
 * WHY A CATALOG (not client-supplied URLs):
 * - Children must never paste arbitrary external image URLs (security + child
 *   safety). The rendered avatar always resolves from this catalog by `avatarId`.
 * - Premium avatar pricing/tier is authoritative here. The client may *display*
 *   the cost, but the server/rules validate the cost against this catalog so a
 *   child cannot forge a cheaper price or a fake ownership record.
 *
 * POINTS SEMANTIC (audited in this sprint):
 * `rewardPoints` is a SPENDABLE reward currency — it is already deducted on
 * reward redemption and awarded by tasks/behaviour/challenges. Therefore avatar
 * unlocks deduct `rewardPoints` once. Selecting an already-owned avatar is free
 * and switching between owned avatars costs nothing.
 *
 * TIERS:
 * - starter: free, available to everyone (no unlock document required).
 * - rare / epic / legendary: premium, require an immutable unlock record and a
 *   one-time point deduction.
 */

export type AvatarTier = 'starter' | 'rare' | 'epic' | 'legendary';

export interface AvatarDefinition {
  /** Stable catalog id. Stored on the user profile as `avatarId`. */
  id: string;
  /** Human-readable name shown in the picker. */
  name: string;
  /** Deterministic, curated image URL. Never a client-supplied value. */
  imageUrl: string;
  /** Catalog tier. */
  tier: AvatarTier;
  /** How the avatar becomes available. */
  unlockType: 'free' | 'points';
  /** Point cost for premium avatars (0 for starter). Integer rewardPoints. */
  costPoints: number;
  /** Optional minimum lifetime level (XP) required. Unused for now but reserved. */
  minimumLevel?: number;
  /** Display / picker ordering. */
  sortOrder: number;
  /** Whether this catalog entry is currently selectable. */
  isActive: boolean;
}

const DICEBEAR = 'https://api.dicebear.com/7.x';

/** Build a deterministic DiceBear URL from a style + seed (stable across renders). */
function dicebear(style: string, seed: string): string {
  return `${DICEBEAR}/${style}/svg?seed=${encodeURIComponent(seed)}`;
}

export const AVATAR_CATALOG: AvatarDefinition[] = [
  // ---------------- STARTER (free, everyone) ----------------
  { id: 'starter-robot', name: 'Bolt Bot', imageUrl: dicebear('bottts', 'starter-robot'), tier: 'starter', unlockType: 'free', costPoints: 0, sortOrder: 1, isActive: true },
  { id: 'starter-cat', name: 'Cosmo Cat', imageUrl: dicebear('avataaars', 'starter-cat'), tier: 'starter', unlockType: 'free', costPoints: 0, sortOrder: 2, isActive: true },
  { id: 'starter-panda', name: 'Pandy', imageUrl: dicebear('avataaars', 'starter-panda'), tier: 'starter', unlockType: 'free', costPoints: 0, sortOrder: 3, isActive: true },
  { id: 'starter-fox', name: 'Foxy', imageUrl: dicebear('avataaars', 'starter-fox'), tier: 'starter', unlockType: 'free', costPoints: 0, sortOrder: 4, isActive: true },
  { id: 'starter-star', name: 'Star Kid', imageUrl: dicebear('avataaars', 'starter-star'), tier: 'starter', unlockType: 'free', costPoints: 0, sortOrder: 5, isActive: true },
  { id: 'starter-rocket', name: 'Rocket', imageUrl: dicebear('bottts', 'starter-rocket'), tier: 'starter', unlockType: 'free', costPoints: 0, sortOrder: 6, isActive: true },
  { id: 'starter-alien', name: 'Zorp', imageUrl: dicebear('bottts', 'starter-alien'), tier: 'starter', unlockType: 'free', costPoints: 0, sortOrder: 7, isActive: true },
  { id: 'starter-bunny', name: 'Bun Bun', imageUrl: dicebear('avataaars', 'starter-bunny'), tier: 'starter', unlockType: 'free', costPoints: 0, sortOrder: 8, isActive: true },
  { id: 'starter-dino', name: 'Dex Dino', imageUrl: dicebear('bottts', 'starter-dino'), tier: 'starter', unlockType: 'free', costPoints: 0, sortOrder: 9, isActive: true },
  { id: 'starter-unicorn', name: 'Uni', imageUrl: dicebear('avataaars', 'starter-unicorn'), tier: 'starter', unlockType: 'free', costPoints: 0, sortOrder: 10, isActive: true },

  // ---------------- RARE (100–250 points) ----------------
  { id: 'rare-neon', name: 'Neon Robot', imageUrl: dicebear('bottts', 'rare-neon'), tier: 'rare', unlockType: 'points', costPoints: 150, sortOrder: 11, isActive: true },
  { id: 'rare-tiger', name: 'Tigger', imageUrl: dicebear('avataaars', 'rare-tiger'), tier: 'rare', unlockType: 'points', costPoints: 200, sortOrder: 12, isActive: true },
  { id: 'rare-wizard', name: 'Wizard', imageUrl: dicebear('avataaars', 'rare-wizard'), tier: 'rare', unlockType: 'points', costPoints: 250, sortOrder: 13, isActive: true },

  // ---------------- EPIC (500–1000 points) ----------------
  { id: 'epic-dragon', name: 'Ember Dragon', imageUrl: dicebear('bottts', 'epic-dragon'), tier: 'epic', unlockType: 'points', costPoints: 500, sortOrder: 14, isActive: true },
  { id: 'epic-phoenix', name: 'Phoenix', imageUrl: dicebear('avataaars', 'epic-phoenix'), tier: 'epic', unlockType: 'points', costPoints: 750, sortOrder: 15, isActive: true },
  { id: 'epic-knight', name: 'Knight', imageUrl: dicebear('avataaars', 'epic-knight'), tier: 'epic', unlockType: 'points', costPoints: 1000, sortOrder: 16, isActive: true },

  // ---------------- LEGENDARY (2000+ points) ----------------
  { id: 'legendary-galaxy', name: 'Galaxy King', imageUrl: dicebear('bottts', 'legendary-galaxy'), tier: 'legendary', unlockType: 'points', costPoints: 2000, sortOrder: 17, isActive: true },
  { id: 'legendary-crown', name: 'Crown Royal', imageUrl: dicebear('avataaars', 'legendary-crown'), tier: 'legendary', unlockType: 'points', costPoints: 3000, sortOrder: 18, isActive: true },
];

const CATALOG_BY_ID = new Map(AVATAR_CATALOG.map(a => [a.id, a]));

export function getAvatarById(id: string | null | undefined): AvatarDefinition | undefined {
  if (!id) return undefined;
  return CATALOG_BY_ID.get(id);
}

export function isStarterAvatar(id: string | null | undefined): boolean {
  const def = getAvatarById(id);
  return !!def && def.tier === 'starter' && def.unlockType === 'free';
}

export function isPremiumAvatar(id: string | null | undefined): boolean {
  const def = getAvatarById(id);
  return !!def && def.unlockType === 'points';
}

/**
 * Authoritative cost lookup. Returns the catalog cost or null when the id is
 * unknown/inactive. The unlock transaction and Firestore rules both rely on
 * this so the client cannot forge a cheaper price.
 */
export function getAvatarCost(id: string | null | undefined): number | null {
  const def = getAvatarById(id);
  if (!def || !def.isActive) return null;
  return def.costPoints;
}

export const TIER_LABELS: Record<AvatarTier, string> = {
  starter: 'Starter',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

/**
 * Resolve a rendered avatar image for a user profile.
 * Prefers the catalog `avatarId`; falls back to a legacy `avatarUrl` (e.g. an
 * old DiceBear link) so existing profiles keep rendering. Never trusts a raw
 * URL when a valid catalog id is present.
 */
export function resolveAvatarImage(avatarId: string | null | undefined, legacyAvatarUrl?: string | null): string | undefined {
  const def = getAvatarById(avatarId);
  if (def) return def.imageUrl;
  return legacyAvatarUrl || undefined;
}

/**
 * Map a legacy DiceBear URL to a catalog id when the seed matches a starter
 * avatar. Returns undefined when no safe mapping exists (caller keeps the raw
 * URL as a fallback and never stores it as a catalog id).
 */
export function mapLegacyUrlToAvatarId(legacyUrl: string | null | undefined): string | undefined {
  if (!legacyUrl) return undefined;
  const seedMatch = legacyUrl.match(/[?&]seed=([^&]+)/i);
  if (!seedMatch) return undefined;
  const seed = decodeURIComponent(seedMatch[1]);
  const match = AVATAR_CATALOG.find(a => a.tier === 'starter' && seed === `starter-${a.id.replace('starter-', '')}` || a.imageUrl.includes(`seed=${seed}`));
  return match?.id;
}
