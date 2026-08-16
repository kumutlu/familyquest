import i18n from '../i18n/config';

// Canonical family roles. `adult` is a normal independent account participating
// in the family; it is NOT a parent and cannot manage children until promoted.
// `owner` is the single family administrator. `parent` can manage children.
// `child` is a (managed or self-registered) minor account.
export type FamilyRole = 'owner' | 'parent' | 'adult' | 'child';

export function normalizeRole(role: unknown): FamilyRole | null {
  if (role === 'owner') return 'owner';
  if (role === 'parent') return 'parent';
  if (role === 'admin') return 'parent'; // Legacy compatibility
  if (role === 'adult') return 'adult';
  if (role === 'child') return 'child';
  return null;
}

export function isOwnerRole(role: unknown): boolean {
  return normalizeRole(role) === 'owner';
}

// Owner and parent may manage children. An `adult` is a normal participant and
// must be promoted to parent before it can manage children.
export function isParentRole(role: unknown): boolean {
  const normalized = normalizeRole(role);
  return normalized === 'owner' || normalized === 'parent';
}

export function isAdultRole(role: unknown): boolean {
  return normalizeRole(role) === 'adult';
}

export function isChildRole(role: unknown): boolean {
  return normalizeRole(role) === 'child';
}

export function getRoleLabel(role: unknown): string | null {
  const normalized = normalizeRole(role);
  if (normalized === 'owner') return i18n.t('common:roles.owner');
  if (normalized === 'parent') return i18n.t('common:roles.parent');
  if (normalized === 'adult') return i18n.t('common:roles.adult');
  if (normalized === 'child') return i18n.t('common:roles.child');
  return null;
}
