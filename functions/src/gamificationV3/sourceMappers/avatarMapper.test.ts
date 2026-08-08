import { describe, it, expect } from 'vitest'
import { mapAvatarUnlock, type AvatarUnlockSource } from './avatarMapper'

describe('avatarMapper', () => {
  it('maps an avatar unlock to an AVATAR_UNLOCKED event', () => {
    const source: AvatarUnlockSource = {
      familyId: 'family-1',
      memberId: 'member-1',
      avatarId: 'epic-dragon',
      costPoints: 500,
      unlockedAt: '2026-01-05T10:00:00.000Z',
      createdAt: '2026-01-05T10:00:00.000Z',
    }
    const event = mapAvatarUnlock(source)
    expect(event.eventType).toBe('AVATAR_UNLOCKED')
    expect(event.eventId).toBe('avatar-unlocked:family-1:member-1:epic-dragon')
    expect(event.rewardPointsDelta).toBe(-500)
    expect(event.xpDelta).toBe(0)
    expect(event.weeklyPointsDelta).toBe(0)
    expect(event.metadata.avatarId).toBe('epic-dragon')
  })
})