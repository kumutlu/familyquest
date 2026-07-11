
export interface BadgeDefinition {
  id: string;
  name: string;
  description: string;
  iconName: string;
  color: string;
  checkUnlocked: (user: any, completions?: any[]) => boolean;
}

export const ACHIEVEMENTS: BadgeDefinition[] = [
  {
    id: 'first_steps',
    name: 'First Steps',
    description: 'Earn your first 50 XP',
    iconName: 'Star',
    color: 'bg-primary-50 text-primary-500 border-primary-200',
    checkUnlocked: (user) => (user.lifetimeXP || 0) >= 50
  },
  {
    id: 'centurion',
    name: 'Centurion',
    description: 'Reach 1,000 Lifetime XP',
    iconName: 'Shield',
    color: 'bg-primary-50 text-primary-500 border-primary-200',
    checkUnlocked: (user) => (user.lifetimeXP || 0) >= 1000
  },
  {
    id: 'streak_starter',
    name: 'On Fire',
    description: 'Achieve a 3-day streak',
    iconName: 'Flame',
    color: 'bg-warning-50 text-warning-500 border-warning-200',
    checkUnlocked: (user) => (user.longestStreak || 0) >= 3
  },
  {
    id: 'streak_master',
    name: 'Streak Master',
    description: 'Achieve a 7-day streak',
    iconName: 'Flame',
    color: 'bg-warning-100 text-warning-600 border-warning-300',
    checkUnlocked: (user) => (user.longestStreak || 0) >= 7
  },
  {
    id: 'wealthy',
    name: 'Piggy Bank',
    description: 'Save up 500 Reward Points at once',
    iconName: 'Award',
    color: 'bg-reward-50 text-reward-500 border-reward-200',
    checkUnlocked: (user) => (user.rewardPoints || 0) >= 500
  },
  {
    id: 'champion',
    name: 'Family Champion',
    description: 'Reach 5,000 Lifetime XP',
    iconName: 'Trophy',
    color: 'bg-reward-100 text-reward-600 border-reward-300',
    checkUnlocked: (user) => (user.lifetimeXP || 0) >= 5000
  }
];
