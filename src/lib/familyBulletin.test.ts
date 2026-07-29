import { describe, expect, it } from 'vitest';
import {
  canUserSeeAnnouncement,
  isAnnouncementActive,
  sortAnnouncements,
  type FamilyAnnouncement,
} from './familyBulletin';

const announcement = (overrides: Partial<FamilyAnnouncement> = {}): FamilyAnnouncement => ({
  id: 'a1', familyId: 'f1', title: 'Title', message: 'Message', type: 'general',
  audienceType: 'family', audienceUserIds: [], priority: 'normal', pinned: false,
  status: 'active', createdBy: 'p1', createdAt: 1, updatedAt: 1, ...overrides,
});

describe('Family Bulletin helpers', () => {
  it('hides scheduled and expired announcements from the active view', () => {
    const now = new Date('2026-07-29T12:00:00Z');
    expect(isAnnouncementActive(announcement({ startsAt: new Date('2026-07-29T13:00:00Z') }), now)).toBe(false);
    expect(isAnnouncementActive(announcement({ expiresAt: new Date('2026-07-29T11:00:00Z') }), now)).toBe(false);
    expect(isAnnouncementActive(announcement({ startsAt: new Date('2026-07-29T11:00:00Z') }), now)).toBe(true);
  });

  it('enforces family, child, adult, and selected audiences', () => {
    const child = { id: 'c1', role: 'child' };
    expect(canUserSeeAnnouncement(announcement({ audienceType: 'family' }), child)).toBe(true);
    expect(canUserSeeAnnouncement(announcement({ audienceType: 'children' }), child)).toBe(true);
    expect(canUserSeeAnnouncement(announcement({ audienceType: 'adults' }), child)).toBe(false);
    expect(canUserSeeAnnouncement(announcement({ audienceType: 'selected', audienceUserIds: ['c2'] }), child)).toBe(false);
    expect(canUserSeeAnnouncement(announcement({ audienceType: 'selected', audienceUserIds: ['c1'] }), child)).toBe(true);
  });

  it('sorts pinned first, then priority, then newest', () => {
    const sorted = sortAnnouncements([
      announcement({ id: 'normal', createdAt: 10 }),
      announcement({ id: 'urgent', priority: 'urgent', createdAt: 1 }),
      announcement({ id: 'pinned', pinned: true, createdAt: 0 }),
    ]);
    expect(sorted.map(item => item.id)).toEqual(['pinned', 'urgent', 'normal']);
  });
});
