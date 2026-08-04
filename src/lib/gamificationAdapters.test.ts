import { describe, expect, it } from 'vitest';
import { adaptGamificationSummary, levelFromXp, xpProgressInLevel } from './gamificationAdapters';
import type { GamificationSummaryV1, DailyProgressV1 } from '../domain/gamification/types';

describe('gamificationAdapters', () => {
  describe('adaptGamificationSummary', () => {
    it('returns unavailable view when summary is null', () => {
      const result = adaptGamificationSummary(null, undefined);
      expect(result).toEqual({
        xpTotal: 0,
        level: 1,
        xpToNextLevel: 1000,
        xpProgressInLevel: 0,
        currentStreak: 0,
        bestStreak: 0,
        perfectDayCount: 0,
        todayProgress: null,
        todayGoalReached: null,
        todayPerfectDay: null,
        isAvailable: false,
        isUpdating: false,
      });
    });

    it('returns unavailable view when summary is undefined', () => {
      const result = adaptGamificationSummary(undefined, undefined);
      expect(result.isAvailable).toBe(false);
    });

    it('keeps the dirty projection own values (priority 2) and flags updating', () => {
      const summary: GamificationSummaryV1 = {
        schemaVersion: 1,
        familyId: 'fam1',
        childId: 'child1',
        xpTotal: 5000,
        level: 5,
        currentStreak: 3,
        bestStreak: 10,
        perfectDayCount: 5,
        lastQualifiedDayKey: '20240101',
        projectionRevision: 1,
        foldedThrough: null,
        rebuildRequired: true,
        earliestDirtyCursor: null,
        projectionStatus: 'ready',
        updatedAt: Date.now(),
      };
      // A dirty projection is still authoritative: its own xpTotal/level are
      // shown (never replaced by the lifetimeXP mirror), flagged as updating.
      const result = adaptGamificationSummary(summary, undefined);
      expect(result.isAvailable).toBe(true);
      expect(result.isUpdating).toBe(true);
      expect(result.xpTotal).toBe(5000);
      expect(result.level).toBe(5);
    });

    it('keeps the rebuilding projection own values (priority 2) and flags updating', () => {
      const summary: GamificationSummaryV1 = {
        schemaVersion: 1,
        familyId: 'fam1',
        childId: 'child1',
        xpTotal: 5000,
        level: 5,
        currentStreak: 3,
        bestStreak: 10,
        perfectDayCount: 5,
        lastQualifiedDayKey: '20240101',
        projectionRevision: 1,
        foldedThrough: null,
        rebuildRequired: false,
        earliestDirtyCursor: null,
        projectionStatus: 'rebuilding',
        updatedAt: Date.now(),
      };
      const result = adaptGamificationSummary(summary, undefined);
      expect(result.isAvailable).toBe(true);
      expect(result.isUpdating).toBe(true);
      expect(result.xpTotal).toBe(5000);
      expect(result.level).toBe(5);
    });

    it('computes level and XP progress from xpTotal', () => {
      const summary: GamificationSummaryV1 = {
        schemaVersion: 1,
        familyId: 'fam1',
        childId: 'child1',
        xpTotal: 2500,
        level: 3,
        currentStreak: 2,
        bestStreak: 5,
        perfectDayCount: 1,
        lastQualifiedDayKey: '20240101',
        projectionRevision: 1,
        foldedThrough: null,
        rebuildRequired: false,
        earliestDirtyCursor: null,
        projectionStatus: 'ready',
        updatedAt: Date.now(),
      };
      const result = adaptGamificationSummary(summary, undefined);
      expect(result.xpTotal).toBe(2500);
      expect(result.level).toBe(3);
      expect(result.xpProgressInLevel).toBe(500);
      expect(result.xpToNextLevel).toBe(500);
      expect(result.isAvailable).toBe(true);
    });

    it('merges today progress when provided', () => {
      const summary: GamificationSummaryV1 = {
        schemaVersion: 1,
        familyId: 'fam1',
        childId: 'child1',
        xpTotal: 1500,
        level: 2,
        currentStreak: 1,
        bestStreak: 3,
        perfectDayCount: 0,
        lastQualifiedDayKey: '20240101',
        projectionRevision: 1,
        foldedThrough: null,
        rebuildRequired: false,
        earliestDirtyCursor: null,
        projectionStatus: 'ready',
        updatedAt: Date.now(),
      };
      const progress: DailyProgressV1 = {
        schemaVersion: 1,
        familyId: 'fam1',
        childId: 'child1',
        dayKey: '20240115',
        timezone: 'Europe/London',
        eligibilitySnapshotId: 'snap1',
        dailyGoalPercentage: 75,
        eligiblePoints: 100,
        approvedPoints: 75,
        eligibleTaskCount: 4,
        approvedTaskCount: 3,
        progressPercentage: 75,
        dailyGoalReached: true,
        perfectDayReached: false,
        finalized: true,
        contributingLogicalCompletionKeys: [],
        invalidatedLogicalCompletionKeys: [],
        calculatedAt: Date.now(),
      };
      const result = adaptGamificationSummary(summary, progress);
      expect(result.todayProgress).toBe(75);
      expect(result.todayGoalReached).toBe(true);
      expect(result.todayPerfectDay).toBe(false);
    });

    it('returns null for today fields when progress is null', () => {
      const summary: GamificationSummaryV1 = {
        schemaVersion: 1,
        familyId: 'fam1',
        childId: 'child1',
        xpTotal: 1000,
        level: 2,
        currentStreak: 0,
        bestStreak: 0,
        perfectDayCount: 0,
        lastQualifiedDayKey: null,
        projectionRevision: 1,
        foldedThrough: null,
        rebuildRequired: false,
        earliestDirtyCursor: null,
        projectionStatus: 'ready',
        updatedAt: Date.now(),
      };
      const result = adaptGamificationSummary(summary, null);
      expect(result.todayProgress).toBe(null);
      expect(result.todayGoalReached).toBe(null);
      expect(result.todayPerfectDay).toBe(null);
    });

    it('handles level 1 correctly (xpTotal < XP_PER_LEVEL)', () => {
      const summary: GamificationSummaryV1 = {
        schemaVersion: 1,
        familyId: 'fam1',
        childId: 'child1',
        xpTotal: 100,
        level: 1,
        currentStreak: 0,
        bestStreak: 0,
        perfectDayCount: 0,
        lastQualifiedDayKey: null,
        projectionRevision: 1,
        foldedThrough: null,
        rebuildRequired: false,
        earliestDirtyCursor: null,
        projectionStatus: 'ready',
        updatedAt: Date.now(),
      };
      const result = adaptGamificationSummary(summary, undefined);
      expect(result.level).toBe(1);
      expect(result.xpProgressInLevel).toBe(100);
      expect(result.xpToNextLevel).toBe(900);
    });

    it('handles exact level boundary correctly', () => {
      const summary: GamificationSummaryV1 = {
        schemaVersion: 1,
        familyId: 'fam1',
        childId: 'child1',
        xpTotal: 1000,
        level: 2,
        currentStreak: 0,
        bestStreak: 0,
        perfectDayCount: 0,
        lastQualifiedDayKey: null,
        projectionRevision: 1,
        foldedThrough: null,
        rebuildRequired: false,
        earliestDirtyCursor: null,
        projectionStatus: 'ready',
        updatedAt: Date.now(),
      };
      const result = adaptGamificationSummary(summary, undefined);
      expect(result.xpProgressInLevel).toBe(0);
      expect(result.xpToNextLevel).toBe(1000);
    });

    it('falls back to member.lifetimeXP when the summary is null and a member is provided', () => {
      const result = adaptGamificationSummary(null, undefined, { lifetimeXP: 2500 });
      expect(result.isAvailable).toBe(true);
      expect(result.xpTotal).toBe(2500);
      expect(result.level).toBe(3);
      expect(result.xpProgressInLevel).toBe(500);
      expect(result.xpToNextLevel).toBe(500);
    });

    it('uses the dirty summary own xpTotal, never the lifetimeXP mirror (priority 2)', () => {
      const summary: GamificationSummaryV1 = {
        schemaVersion: 1,
        familyId: 'fam1',
        childId: 'child1',
        xpTotal: 9999,
        level: 99,
        currentStreak: 3,
        bestStreak: 10,
        perfectDayCount: 5,
        lastQualifiedDayKey: '20240101',
        projectionRevision: 1,
        foldedThrough: null,
        rebuildRequired: true,
        earliestDirtyCursor: null,
        projectionStatus: 'ready',
        updatedAt: Date.now(),
      };
      // A dirty projection is still authoritative: its own xpTotal is shown,
      // NOT the legacy lifetimeXP mirror (1000).
      const result = adaptGamificationSummary(summary, undefined, { lifetimeXP: 1000 });
      expect(result.isAvailable).toBe(true);
      expect(result.isUpdating).toBe(true);
      expect(result.xpTotal).toBe(9999);
      expect(result.level).toBe(99);
    });

    it('uses the rebuilding summary own xpTotal, never the lifetimeXP mirror (priority 2)', () => {
      const summary: GamificationSummaryV1 = {
        schemaVersion: 1,
        familyId: 'fam1',
        childId: 'child1',
        xpTotal: 9999,
        level: 99,
        currentStreak: 3,
        bestStreak: 10,
        perfectDayCount: 5,
        lastQualifiedDayKey: '20240101',
        projectionRevision: 1,
        foldedThrough: null,
        rebuildRequired: false,
        earliestDirtyCursor: null,
        projectionStatus: 'rebuilding',
        updatedAt: Date.now(),
      };
      const result = adaptGamificationSummary(summary, undefined, { lifetimeXP: 420 });
      expect(result.isAvailable).toBe(true);
      expect(result.isUpdating).toBe(true);
      expect(result.xpTotal).toBe(9999);
    });

    it('still returns unavailable when no member is available to fall back to', () => {
      // No member => no authoritative lifetimeXP to derive from => nothing to show.
      const result = adaptGamificationSummary(null, undefined);
      expect(result.isAvailable).toBe(false);
      expect(result.isUpdating).toBe(false);
    });

    it('REQUIRED: dirty summary xpTotal=420 with member.lifetimeXP=400 keeps 420', () => {
      const summary: GamificationSummaryV1 = {
        schemaVersion: 1,
        familyId: 'fam1',
        childId: 'child1',
        xpTotal: 420,
        level: 1,
        currentStreak: 0,
        bestStreak: 0,
        perfectDayCount: 0,
        lastQualifiedDayKey: null,
        projectionRevision: 1,
        foldedThrough: null,
        rebuildRequired: true,
        earliestDirtyCursor: null,
        projectionStatus: 'ready',
        updatedAt: Date.now(),
      };
      const result = adaptGamificationSummary(summary, undefined, { lifetimeXP: 400 });
      expect(result.isAvailable).toBe(true);
      expect(result.xpTotal).toBe(420);
      expect(result.level).toBe(1);
    });

    it('REQUIRED: ready summary xpTotal=420 is authoritative', () => {
      const summary: GamificationSummaryV1 = {
        schemaVersion: 1,
        familyId: 'fam1',
        childId: 'child1',
        xpTotal: 420,
        level: 1,
        currentStreak: 0,
        bestStreak: 0,
        perfectDayCount: 0,
        lastQualifiedDayKey: null,
        projectionRevision: 1,
        foldedThrough: null,
        rebuildRequired: false,
        earliestDirtyCursor: null,
        projectionStatus: 'ready',
        updatedAt: Date.now(),
      };
      const result = adaptGamificationSummary(summary, undefined, { lifetimeXP: 400 });
      expect(result.isAvailable).toBe(true);
      expect(result.xpTotal).toBe(420);
    });

    it('REQUIRED: missing summary with member.lifetimeXP=400 falls back to 400', () => {
      const result = adaptGamificationSummary(null, undefined, { lifetimeXP: 400 });
      expect(result.isAvailable).toBe(true);
      expect(result.xpTotal).toBe(400);
    });

    it('REQUIRED: missing summary and no lifetimeXP renders unavailable', () => {
      const result = adaptGamificationSummary(null, undefined, { lifetimeXP: undefined });
      expect(result.isAvailable).toBe(false);
      expect(result.xpTotal).toBe(0);
    });
  });

  describe('levelFromXp', () => {
    it('returns level 1 for zero XP', () => {
      expect(levelFromXp(0)).toBe(1);
    });

    it('returns level 1 for XP below first level', () => {
      expect(levelFromXp(999)).toBe(1);
    });

    it('returns level 2 for exactly 1000 XP', () => {
      expect(levelFromXp(1000)).toBe(2);
    });

    it('returns correct level for higher XP values', () => {
      expect(levelFromXp(2500)).toBe(3);
      expect(levelFromXp(5000)).toBe(6);
    });
  });

  describe('xpProgressInLevel', () => {
    it('returns 0 for exact level boundary', () => {
      expect(xpProgressInLevel(1000)).toBe(0);
      expect(xpProgressInLevel(2000)).toBe(0);
    });

    it('returns correct progress within level', () => {
      expect(xpProgressInLevel(1500)).toBe(500);
      expect(xpProgressInLevel(2500)).toBe(500);
    });

    it('returns XP value for first level', () => {
      expect(xpProgressInLevel(500)).toBe(500);
    });
  });
});