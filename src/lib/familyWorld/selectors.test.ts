import { describe, it, expect } from 'vitest';
import {
  selectMemberSummaries,
  selectActiveFamilyQuest,
  selectSharedProgression,
  selectRecentFamilyMoments,
  selectFamilyWorldViewModel,
} from './selectors';
import type {
  FamilyMemberEntity,
  ChallengeEntity,
  TaskEntity,
  TaskCompletionEntity,
  GamificationSummaryEntity,
  TransactionEntity,
} from './types';

describe('FamilyWorld Selectors', () => {
  const mockParent: FamilyMemberEntity = {
    id: 'parent-1',
    displayName: 'Kemal (Parent)',
    role: 'parent',
    familyId: 'fam-1',
    ['rewardPoints']: 0,
    ['lifetimeXP']: 0,
  };

  const mockChild1: FamilyMemberEntity = {
    id: 'child-1',
    displayName: 'Ada',
    role: 'child',
    familyId: 'fam-1',
    ['rewardPoints']: 40,
    ['lifetimeXP']: 250,
    streak: { current: 5, longest: 7 },
  };

  const mockChild2: FamilyMemberEntity = {
    id: 'child-2',
    displayName: 'Ali',
    role: 'child',
    familyId: 'fam-1',
    ['rewardPoints']: 10,
    ['lifetimeXP']: 100,
    streak: { current: 3, longest: 3 },
  };

  const mockDeletedChild: FamilyMemberEntity = {
    id: 'child-deleted',
    displayName: 'Old Child',
    role: 'child',
    familyId: 'fam-1',
    status: 'deleted',
  };

  const mockGamificationSummaries: GamificationSummaryEntity[] = [
    {
      id: 'child-1',
      familyId: 'fam-1',
      pointsBalance: 40,
      xpTotal: 250,
      level: 3,
      currentLevelXp: 50,
      nextLevelXp: 100,
      updatedAt: new Date() as any,
    },
    {
      id: 'child-2',
      familyId: 'fam-1',
      pointsBalance: 10,
      xpTotal: 100,
      level: 1,
      currentLevelXp: 0,
      nextLevelXp: 100,
      updatedAt: new Date() as any,
    },
  ];

  describe('selectMemberSummaries', () => {
    it('filters out deleted/disabled members', () => {
      const members = selectMemberSummaries(
        [mockParent, mockChild1, mockChild2, mockDeletedChild],
        mockParent,
        mockGamificationSummaries
      );
      expect(members.length).toBe(3);
      expect(members.find((m) => m.id === 'child-deleted')).toBeUndefined();
    });

    it('allows parent to view child wallet balance but conceals sibling balance when viewed by child', () => {
      // Parent viewing
      const parentView = selectMemberSummaries(
        [mockParent, mockChild1, mockChild2],
        mockParent,
        mockGamificationSummaries
      );
      const child1InParentView = parentView.find((m) => m.id === 'child-1');
      expect(child1InParentView?.canViewWallet).toBe(true);
      expect(child1InParentView?.walletBalanceFormatted).toBe('40 pts');

      // Child 1 viewing Child 2
      const childView = selectMemberSummaries(
        [mockParent, mockChild1, mockChild2],
        mockChild1,
        mockGamificationSummaries
      );
      const child2InChildView = childView.find((m) => m.id === 'child-2');
      expect(child2InChildView?.canViewWallet).toBe(false);
      expect(child2InChildView?.walletBalanceFormatted).toBeUndefined();

      // Child 1 viewing self
      const selfInChildView = childView.find((m) => m.id === 'child-1');
      expect(selfInChildView?.canViewWallet).toBe(true);
      expect(selfInChildView?.walletBalanceFormatted).toBe('40 pts');
    });

    it('sets role-aware permissions (canManage, canSendMoney)', () => {
      const parentView = selectMemberSummaries(
        [mockParent, mockChild1],
        mockParent,
        mockGamificationSummaries
      );
      const child1 = parentView.find((m) => m.id === 'child-1');
      expect(child1?.canManage).toBe(true);
      expect(child1?.canSendMoney).toBe(true);

      const childView = selectMemberSummaries(
        [mockParent, mockChild1],
        mockChild1,
        mockGamificationSummaries
      );
      const parentInChildView = childView.find((m) => m.id === 'parent-1');
      expect(parentInChildView?.canManage).toBe(false);
    });
  });

  describe('selectActiveFamilyQuest', () => {
    const mockChallenge: ChallengeEntity = {
      id: 'chal-1',
      familyId: 'fam-1',
      title: 'Weekend Warriors',
      description: 'Complete family quests together',
      targetXP: 200,
      startXP: 100,
      ['rewardPoints']: 50,
      isActive: true,
      createdAt: new Date() as any,
    };

    it('calculates progress percentage and target correctly from total family XP', () => {
      // Total family XP = 250 (child 1) + 100 (child 2) = 350
      // startXP = 100, targetXP = 200 -> earned = 250 -> 100% (target reached)
      const quest = selectActiveFamilyQuest(
        [mockChallenge],
        [mockChild1, mockChild2],
        mockGamificationSummaries,
        mockParent
      );

      expect(quest).not.toBeNull();
      expect(quest?.title).toBe('Weekend Warriors');
      expect(quest?.isCompleted).toBe(true);
      expect(quest?.current).toBe(200); // Capped at target
      expect(quest?.target).toBe(200);
      expect(quest?.percentage).toBe(100);
      expect(quest?.points).toBe(50);
      expect(quest?.canClaim).toBe(true);
    });

    it('determines child canClaim as false (parent only claim rule)', () => {
      const quest = selectActiveFamilyQuest(
        [mockChallenge],
        [mockChild1, mockChild2],
        mockGamificationSummaries,
        mockChild1
      );
      expect(quest?.canClaim).toBe(false);
    });

    it('returns null when no active challenge exists', () => {
      const quest = selectActiveFamilyQuest(
        [],
        [mockChild1, mockChild2],
        mockGamificationSummaries,
        mockParent
      );
      expect(quest).toBeNull();
    });
  });

  describe('selectSharedProgression', () => {
    it('aggregates completed tasks and active streaks deterministically without fake Family XP', () => {
      const mockCompletions: TaskCompletionEntity[] = [
        { id: 'c1', taskId: 't1', childId: 'child-1', familyId: 'fam-1', completedAt: new Date() as any },
        { id: 'c2', taskId: 't2', childId: 'child-2', familyId: 'fam-1', completedAt: new Date() as any },
      ];

      const progression = selectSharedProgression(
        [mockChild1, mockChild2],
        mockGamificationSummaries,
        mockCompletions,
        []
      );

      expect(progression.totalCompletedTasks).toBe(2);
      expect(progression.activeStreaksCount).toBe(2); // child1 (5) and child2 (3) both > 0
    });
  });

  describe('selectRecentFamilyMoments', () => {
    it('returns sparse, prioritized moments and enforces max 3 items', () => {
      const mockTasks: TaskEntity[] = [
        { id: 't1', title: 'Clean room', ['rewardPoints']: 10, status: 'approved', approvalStatus: 'approved', completedBy: 'child-1', familyId: 'fam-1', updatedAt: new Date() as any },
        { id: 't2', title: 'Read book', ['rewardPoints']: 15, status: 'approved', approvalStatus: 'approved', completedBy: 'child-2', familyId: 'fam-1', updatedAt: new Date() as any },
      ];
      const mockTransactions: TransactionEntity[] = [
        { id: 'tx1', type: 'transfer', amount: 500, fromUserId: 'parent-1', toUserId: 'child-1', fromUserName: 'Kemal', toUserName: 'Ada', timestamp: new Date() as any },
      ];

      const moments = selectRecentFamilyMoments(
        [mockChild1, mockChild2, mockParent],
        mockTasks,
        [],
        mockTransactions
      );

      expect(moments.length).toBeLessThanOrEqual(3);
      expect(moments.length).toBeGreaterThan(0);
      expect(moments[0].id).toBeDefined();
    });
  });

  describe('selectFamilyWorldViewModel', () => {
    it('adapts single-child vs multi-child flag accurately', () => {
      // 1 child
      const singleChildModel = selectFamilyWorldViewModel({
        familyMembers: [mockParent, mockChild1],
        currentUser: mockParent,
        tasks: [],
        taskCompletions: [],
        challenges: [],
        gamificationSummaries: [mockGamificationSummaries[0]],
      });
      expect(singleChildModel.isSingleChild).toBe(true);
      expect(singleChildModel.activeChildren.length).toBe(1);

      // 2 children
      const multiChildModel = selectFamilyWorldViewModel({
        familyMembers: [mockParent, mockChild1, mockChild2],
        currentUser: mockParent,
        tasks: [],
        taskCompletions: [],
        challenges: [],
        gamificationSummaries: mockGamificationSummaries,
      });
      expect(multiChildModel.isSingleChild).toBe(false);
      expect(multiChildModel.activeChildren.length).toBe(2);
    });
  });
});
