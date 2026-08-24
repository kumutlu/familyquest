import type {
  FamilyMemberEntity,
  ChallengeEntity,
  TaskEntity,
  TaskCompletionEntity,
  GamificationSummaryEntity,
  TransactionEntity,
  FamilyWorldViewModel,
  MemberSummary,
  FamilyQuestSummary,
  SharedProgressionSummary,
  FamilyMoment,
  AchievementSummary,
  ContributionItem,
} from './types';
import { isChildRole, isParentRole, isOwnerRole } from '../roles';

export function selectMemberSummaries(
  familyMembers: FamilyMemberEntity[],
  currentUser: FamilyMemberEntity | null,
  gamificationSummaries: GamificationSummaryEntity[] = [],
  childWallets: { id: string; balance: number }[] = []
): MemberSummary[] {
  if (!familyMembers || familyMembers.length === 0) return [];

  const summaryMap = new Map<string, GamificationSummaryEntity>();
  for (const s of gamificationSummaries) {
    if (s && s.id) {
      summaryMap.set(s.id, s);
    }
  }

  const isParentViewer =
    currentUser && (isParentRole(currentUser.role) || isOwnerRole(currentUser.role));

  const activeMembers = familyMembers.filter(
    (m) => m.status !== 'deleted' && m.status !== 'disabled' && !m.disabled
  );

  return activeMembers.map((member) => {
    const isSelf = !!currentUser && currentUser.id === member.id;
    const summary = summaryMap.get(member.id);

    const level = summary?.level ?? member.level ?? 1;
    const xp = summary?.xpTotal ?? (member as any)['lifetimeXP'] ?? 0;
    const streakDays = member.streak?.current ?? 0;
    const pointsBalance = summary?.pointsBalance ?? (member as any)['rewardPoints'] ?? 0;

    // Financial Privacy: only parents or self can see points / wallet balances
    const canViewWallet = !!(isParentViewer || isSelf);

    // Get canonical wallet balance from childWallets (families/{familyId}/wallets/{childId})
    const walletDoc = childWallets.find(w => w.id === member.id);
    const walletBalancePence = walletDoc?.balance ?? 0;
    const walletBalanceFormatted = canViewWallet && walletDoc
      ? `£${(walletBalancePence / 100).toFixed(2)}`
      : undefined;

    // Action permissions
    const canSendMoney = !!(
      currentUser &&
      !isSelf &&
      (isParentViewer || (isChildRole(currentUser.role) && isChildRole(member.role)))
    );
    const canViewQuests = true;
    const canManage = !!(
      isParentViewer &&
      (member.role === 'child' || currentUser.role === 'owner')
    );

    // Derived member achievements
    const recentAchievements: AchievementSummary[] = [];
    if (streakDays >= 3) {
      recentAchievements.push({
        id: `streak-${member.id}-${streakDays}`,
        title: `${streakDays}-Day Streak`,
        description: 'Consistency champion',
        category: 'streak',
        isUnlocked: true,
      });
    }
    if (level >= 2) {
      recentAchievements.push({
        id: `level-${member.id}-${level}`,
        title: `Level ${level}`,
        description: 'Knowledge adventurer',
        category: 'level',
        isUnlocked: true,
      });
    }

    return {
      id: member.id,
      displayName: member.displayName || 'Family Member',
      role: member.role,
      avatarUrl: member.avatarUrl,
      avatarId: (member as any).avatar,
      level,
      xp,
      points: pointsBalance,
      streakDays,
      walletBalancePence,
      walletBalanceFormatted,
      canViewWallet,
      isSelf,
      canSendMoney,
      canViewQuests,
      canManage,
      recentAchievements,
    };
  });
}

export function selectActiveFamilyQuest(
  challenges: ChallengeEntity[] = [],
  familyMembers: FamilyMemberEntity[] = [],
  gamificationSummaries: GamificationSummaryEntity[] = [],
  currentUser: FamilyMemberEntity | null = null
): FamilyQuestSummary | null {
  if (!challenges || challenges.length === 0) return null;

  const activeChallenge = challenges.find((c) => c.isActive);
  if (!activeChallenge) return null;

  const eligibleChildren = familyMembers.filter(
    (c) => isChildRole(c.role) && c.status !== 'deleted' && c.status !== 'disabled' && !c.disabled
  );

  const xpByChild = new Map(
    (gamificationSummaries || []).map((s) => [s.id, s.xpTotal ?? 0])
  );

  const totalFamilyXP = eligibleChildren.reduce((acc, child) => {
    const summaryXp = xpByChild.get(child.id);
    return acc + (typeof summaryXp === 'number' ? summaryXp : ((child as any)['lifetimeXP'] || 0));
  }, 0);

  const earnedSinceStart = Math.max(0, totalFamilyXP - (activeChallenge.startXP || 0));
  const target = activeChallenge.targetXP || 100;
  const current = Math.min(earnedSinceStart, target);
  const percentage = Math.min(100, Math.floor((earnedSinceStart / target) * 100));
  const isCompleted = earnedSinceStart >= target;

  const deadline = (activeChallenge.endsAt as any)?.toDate?.() ?? null;
  const daysRemaining = deadline
    ? Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / 86_400_000))
    : null;

  const isParentViewer =
    currentUser && (isParentRole(currentUser.role) || isOwnerRole(currentUser.role));
  const canClaim = !!(isCompleted && isParentViewer);

  // Contributions breakdown if any (calculated safely from member XP)
  const contributions: ContributionItem[] = eligibleChildren.map((c) => {
    const childTotalXp = xpByChild.get(c.id) ?? (c as any)['lifetimeXP'] ?? 0;
    return {
      memberId: c.id,
      displayName: c.displayName,
      avatarUrl: c.avatarUrl,
      count: childTotalXp,
    };
  });

  return {
    id: activeChallenge.id,
    title: activeChallenge.title,
    description: activeChallenge.description || '',
    target,
    current,
    percentage,
    isCompleted,
    isClaimed: false,
    daysRemaining,
    rewardXp: (activeChallenge as any).rewardXP ?? 0,
    points: (activeChallenge as any)['rewardPoints'] ?? (activeChallenge as any).pointsReward ?? 0,
    contributions,
    canClaim,
  };
}

export function selectSharedProgression(
  familyMembers: FamilyMemberEntity[] = [],
  _gamificationSummaries: GamificationSummaryEntity[] = [],
  taskCompletions: TaskCompletionEntity[] = [],
  challenges: ChallengeEntity[] = []
): SharedProgressionSummary {
  const activeChildren = familyMembers.filter(
    (m) => isChildRole(m.role) && m.status !== 'deleted' && m.status !== 'disabled' && !m.disabled
  );

  const totalCompletedTasks = taskCompletions ? taskCompletions.length : 0;
  const completedChallengesCount = challenges
    ? challenges.filter((c) => !c.isActive && c.completedAt).length
    : 0;

  const activeStreaksCount = activeChildren.filter((c) => (c.streak?.current ?? 0) > 0).length;

  return {
    title: 'Family Progress',
    subtitle: 'Our collective achievements and momentum',
    totalCompletedTasks,
    completedChallengesCount,
    activeStreaksCount,
  };
}

export function selectRecentFamilyMoments(
  familyMembers: FamilyMemberEntity[] = [],
  tasks: TaskEntity[] = [],
  challenges: ChallengeEntity[] = [],
  transactions: TransactionEntity[] = []
): FamilyMoment[] {
  const moments: FamilyMoment[] = [];
  const memberMap = new Map(familyMembers.map((m) => [m.id, m]));

  // 1. Recent approved quests (up to 2)
  const approvedTasks = (tasks || [])
    .filter((t) => t.status === 'approved' || (t as any).approvalStatus === 'approved')
    .slice(0, 2);

  for (const t of approvedTasks) {
    const child = memberMap.get(t.completedBy || '');
    moments.push({
      id: `task-approved-${t.id}`,
      type: 'quest_approved',
      title: `${child?.displayName || 'Child'} completed "${t.title}"`,
      description: `Quest confirmed and rewards granted.`,
      timestamp: (t.updatedAt as any)?.toDate?.() || new Date(),
      primaryActorName: child?.displayName || 'Child',
      primaryActorAvatarUrl: child?.avatarUrl,
      primaryActorAvatarId: (child as any)?.avatar,
      targetRoute: `/tasks?member=${t.completedBy}`,
      priority: 80,
    });
  }

  // 2. Recent money transfer events
  const recentTransfers = (transactions || [])
    .filter((tx) => tx.type === 'transfer')
    .slice(0, 2);

  for (const tx of recentTransfers) {
    moments.push({
      id: `tx-transfer-${tx.id}`,
      type: 'money_transferred',
      title: `${tx.fromUserName || 'Family Member'} sent money`,
      description: `${tx.fromUserName || 'Family Member'} transferred funds to ${tx.toUserName || 'recipient'}.`,
      timestamp: (tx.timestamp as any)?.toDate?.() || new Date(),
      primaryActorName: tx.fromUserName || 'Family Member',
      targetRoute: '/wallet',
      priority: 90,
    });
  }

  // 3. Completed challenges
  const completedChallenge = (challenges || []).find((c) => !c.isActive && c.completedAt);
  if (completedChallenge) {
    moments.push({
      id: `challenge-completed-${completedChallenge.id}`,
      type: 'family_quest_completed',
      title: `Family Quest "${completedChallenge.title}" Completed!`,
      description: `The whole family worked together to reach the goal.`,
      timestamp: (completedChallenge.completedAt as any)?.toDate?.() || new Date(),
      primaryActorName: 'Our Family',
      priority: 100,
    });
  }

  // Sort by priority desc, then timestamp desc, limit to 3 sparse items
  return moments
    .sort((a, b) => b.priority - a.priority || (b.timestamp?.getTime() || 0) - (a.timestamp?.getTime() || 0))
    .slice(0, 3);
}

export function selectSharedAchievements(
  challenges: ChallengeEntity[] = [],
  taskCompletions: TaskCompletionEntity[] = []
): AchievementSummary[] {
  const achievements: AchievementSummary[] = [];

  const completedCount = taskCompletions ? taskCompletions.length : 0;
  if (completedCount >= 10) {
    achievements.push({
      id: 'family-team-10',
      title: 'Task Force 10',
      description: 'Completed 10 quests as a family',
      category: 'quest',
      isUnlocked: true,
    });
  }

  const challengesDone = (challenges || []).filter((c) => !c.isActive && c.completedAt).length;
  if (challengesDone >= 1) {
    achievements.push({
      id: 'family-first-quest',
      title: 'United We Stand',
      description: 'Completed your first Family Quest',
      category: 'family',
      isUnlocked: true,
    });
  }

  return achievements;
}

export function selectFamilyWorldViewModel(params: {
  familyMembers: FamilyMemberEntity[];
  currentUser: FamilyMemberEntity | null;
  tasks?: TaskEntity[];
  taskCompletions?: TaskCompletionEntity[];
  challenges?: ChallengeEntity[];
  gamificationSummaries?: GamificationSummaryEntity[];
  transactions?: TransactionEntity[];
  childWallets?: { id: string; balance: number }[];
}): FamilyWorldViewModel {
  const {
    familyMembers = [],
    currentUser,
    tasks = [],
    taskCompletions = [],
    challenges = [],
    gamificationSummaries = [],
    transactions = [],
    childWallets = [],
  } = params;

  const members = selectMemberSummaries(familyMembers, currentUser, gamificationSummaries, childWallets);
  const activeChildren = members.filter((m) => m.role === 'child');
  const isSingleChild = activeChildren.length === 1;

  const activeFamilyQuest = selectActiveFamilyQuest(
    challenges,
    familyMembers,
    gamificationSummaries,
    currentUser
  );

  const sharedProgression = selectSharedProgression(
    familyMembers,
    gamificationSummaries,
    taskCompletions,
    challenges
  );

  const recentMoments = selectRecentFamilyMoments(
    familyMembers,
    tasks,
    challenges,
    transactions
  );

  const sharedAchievements = selectSharedAchievements(challenges, taskCompletions);

  const familyName = currentUser?.familyId ? 'Our Family' : 'Family';

  return {
    familyIdentity: {
      id: currentUser?.familyId || 'family',
      name: familyName,
    },
    viewerRole: currentUser?.role || 'child',
    members,
    activeChildren,
    isSingleChild,
    activeFamilyQuest,
    sharedProgression,
    recentMoments,
    sharedAchievements,
  };
}
