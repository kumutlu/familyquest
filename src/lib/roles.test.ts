import { describe, it, expect } from 'vitest';
import { normalizeRole, isOwnerRole, isParentRole } from './roles';

describe('Role helper', () => {
  it('1. owner -> owner', () => expect(normalizeRole('owner')).toBe('owner'));
  it('2. parent -> parent', () => expect(normalizeRole('parent')).toBe('parent'));
  it('3. admin -> parent', () => expect(normalizeRole('admin')).toBe('parent'));
  it('4. child -> child', () => expect(normalizeRole('child')).toBe('child'));
  it('5. unknown -> null', () => expect(normalizeRole('weird_role')).toBeNull());
  it('6. missing -> null', () => {
    expect(normalizeRole(undefined)).toBeNull();
    expect(normalizeRole(null)).toBeNull();
  });
  it('7. admin is not owner', () => expect(isOwnerRole('admin')).toBe(false));
  it('8. owner is parent-capable', () => expect(isParentRole('owner')).toBe(true));
  it('9. parent is parent-capable', () => expect(isParentRole('parent')).toBe(true));
  it('10. child is not parent-capable', () => expect(isParentRole('child')).toBe(false));
});
