export type FamilyWorldViewerRole = 'owner' | 'parent' | 'adult' | 'child';

export interface FamilyMemberEntity {
  id: string;
  familyId?: string;
  displayName: string;
  role: FamilyWorldViewerRole | string;
  avatarUrl?: string;
  avatar?: string;
  avatarId?: string;
  level?: number;
  points?: number;
  streak?: { current: number; longest: number };
  currentStreak?: number;
  longestStreak?: number;
  status?: string;
  disabled?: boolean;
  isManaged?: boolean;
  [key: string]: any;
}

export interface ChallengeEntity {
  id: string;
  familyId: string;
  title: string;
  description?: string;
  targetXP: number;
  startXP?: number;
  rewardXP?: number;
  rewardPoints?: number;
  pointsReward?: number;
  isActive: boolean;
  completedAt?: any;
  endsAt?: any;
  createdAt?: any;
  [key: string]: any;
}

export interface TaskEntity {
  id: string;
  familyId: string;
  title: string;
  status: string;
  approvalStatus?: string;
  completedBy?: string;
  points?: number;
  updatedAt?: any;
  completedAt?: any;
  [key: string]: any;
}

export interface TaskCompletionEntity {
  id: string;
  taskId: string;
  childId: string;
  familyId: string;
  completedAt?: any;
}

export interface GamificationSummaryEntity {
  id: string;
  familyId?: string;
  childId?: string;
  pointsBalance?: number;
  xpTotal?: number;
  level?: number;
  currentLevelXp?: number;
  nextLevelXp?: number;
  currentStreak?: number;
  bestStreak?: number;
  updatedAt?: any;
}

export interface TransactionEntity {
  id: string;
  type: string;
  amount: number;
  fromUserId?: string;
  toUserId?: string;
  fromUserName?: string;
  toUserName?: string;
  timestamp?: any;
}

export interface FamilyIdentity {
  id: string;
  name: string;
}

export interface MemberSummary {
  id: string;
  displayName: string;
  role: string;
  avatarUrl?: string;
  avatarId?: string;
  level: number;
  xp: number;
  points: number;
  streakDays: number;
  walletBalancePence?: number; // Canonical wallet balance in minor units (pence)
  walletBalanceFormatted?: string; // Formatted for display (e.g., "£24.50")
  canViewWallet: boolean;
  isSelf: boolean;
  canSendMoney: boolean;
  canViewQuests: boolean;
  canManage: boolean;
  recentAchievements?: AchievementSummary[];
}

export interface ContributionItem {
  memberId: string;
  displayName: string;
  avatarUrl?: string;
  count: number;
}

export interface FamilyQuestSummary {
  id: string;
  title: string;
  description?: string;
  target: number;
  current: number;
  percentage: number;
  isCompleted: boolean;
  isClaimed: boolean;
  daysRemaining: number | null;
  rewardXp: number;
  points: number;
  contributions: ContributionItem[];
  canClaim: boolean;
}

export interface SharedProgressionSummary {
  title: string;
  subtitle: string;
  totalCompletedTasks: number;
  completedChallengesCount: number;
  activeStreaksCount: number;
}

export interface FamilyMoment {
  id: string;
  type:
    | 'quest_approved'
    | 'money_transferred'
    | 'family_quest_completed'
    | 'streak_milestone'
    | 'level_up'
    | 'reward_redeemed'
    | 'achievement_unlocked';
  title: string;
  description: string;
  timestamp?: Date;
  primaryActorName?: string;
  primaryActorAvatarUrl?: string;
  primaryActorAvatarId?: string;
  targetRoute?: string;
  priority: number;
}

export interface AchievementSummary {
  id: string;
  title: string;
  description?: string;
  category: 'quest' | 'streak' | 'family' | 'reward' | 'level';
  isUnlocked: boolean;
  unlockedAt?: Date;
}

export interface FamilyWorldViewModel {
  familyIdentity: FamilyIdentity;
  viewerRole: string;
  members: MemberSummary[];
  activeChildren: MemberSummary[];
  isSingleChild: boolean;
  activeFamilyQuest: FamilyQuestSummary | null;
  sharedProgression: SharedProgressionSummary;
  recentMoments: FamilyMoment[];
  sharedAchievements: AchievementSummary[];
}
