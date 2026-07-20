import i18n from '../i18n/config';

export type FamilyRole = 'owner' | 'parent' | 'child';

export function normalizeRole(role: unknown): FamilyRole | null {
  if (role === 'owner') return 'owner';
  if (role === 'parent') return 'parent';
  if (role === 'admin') return 'parent'; // Legacy compatibility
  if (role === 'child') return 'child';
  return null;
}

export function isOwnerRole(role: unknown): boolean {
  return normalizeRole(role) === 'owner';
}

export function isParentRole(role: unknown): boolean {
  const normalized = normalizeRole(role);
  return normalized === 'owner' || normalized === 'parent';
}

export function isChildRole(role: unknown): boolean {
  return normalizeRole(role) === 'child';
}

export function getRoleLabel(role: unknown): string | null {
  const normalized = normalizeRole(role);
  if (normalized === 'owner') return i18n.t('common:roles.owner');
  if (normalized === 'parent') return i18n.t('common:roles.parent');
  if (normalized === 'child') return i18n.t('common:roles.child');
  return null;
}
