import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Hourglass,
  Wallet as WalletIcon,
  Sword,
  Flame,
  Gift,
  Star,
  Swords,
  PartyPopper,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { adaptGamificationSummary } from '../../lib/gamificationAdapters';
import { selectChildFocus, type ChildFocus } from '../../lib/home/priorities';
import { formatMoney } from '../../lib/walletPresentation';
import { Surface } from '../queki/Surface';
import { TactileCard } from '../queki/TactileCard';
import { LivingHomeCard } from '../queki/LivingHomeCard';
import { CharacterFrame } from '../queki/CharacterFrame';
import { QuekiMascot } from '../queki/QuekiMascot';
import { XPDisplay } from '../queki/semanticDisplays';
import { ProgressBar } from '../queki/Progress';
import { TactileButton } from '../queki/TactileButton';

/**
 * Child Living Home — Queki v2 Wave 1.
 *
 * Personal state first (character, level, XP, streak, points, wallet), then
 * 1–3 dynamic focus items from the deterministic child selector. XP / points /
 * real money each keep their own semantic identity. No history feeds.
 */

const FOCUS_TESTID: Record<ChildFocus['kind'], string> = {
  approval_waiting: 'focus-approval-waiting',
  money_received: 'focus-money-received',
  next_quest: 'focus-next-quest',
  streak_keep: 'focus-streak',
  reward_available: 'focus-reward',
  family_quest: 'focus-family-quest',
};

export function ChildLivingHome() {
  const { t } = useTranslation('home');
  const navigate = useNavigate();
  const {
    currentUser,
    tasks,
    taskCompletions,
    rewards,
    walletTransactions,
    challenges,
    myGamificationSummary,
    myDailyProgress,
    myWallet,
    bootstrapStatus,
    retryFeature,
  } = useStore();

  const gamification = useMemo(
    () => adaptGamificationSummary(myGamificationSummary, myDailyProgress, currentUser),
    [myGamificationSummary, myDailyProgress, currentUser],
  );

  const focus = useMemo(
    () =>
      selectChildFocus({
        currentUser,
        tasks,
        taskCompletions,
        rewards,
        walletTransactions,
        challenges,
        gamificationSummary: gamification.isAvailable
          ? { currentStreak: gamification.currentStreak }
          : null,
        dailyProgress: gamification.todayGoalReached != null ? { dailyGoalReached: gamification.todayGoalReached } : null,
      }),
    [currentUser, tasks, taskCompletions, rewards, walletTransactions, challenges, gamification],
  );

  const mascotState = focus.some(f => f.kind === 'money_received' || f.kind === 'reward_available')
    ? 'celebration'
    : 'encouraging';

  const resourcesLoading =
    !bootstrapStatus ||
    (['tasks', 'members'] as const).some(
      resource => bootstrapStatus[resource] === 'loading' || bootstrapStatus[resource] === 'idle',
    );

  const renderFocus = (item: ChildFocus) => {
    switch (item.kind) {
      case 'approval_waiting':
        return (
          <LivingHomeCard
            key={item.id}
            data-testid={FOCUS_TESTID[item.kind]}
            tone="streak"
            icon={<Hourglass size={22} />}
            title={t('child.approvalWaiting.title', { count: item.count ?? 0 })}
            description={t('child.approvalWaiting.description')}
            onPress={() => navigate('/tasks')}
          />
        );
      case 'money_received':
        return (
          <LivingHomeCard
            key={item.id}
            data-testid={FOCUS_TESTID[item.kind]}
            tone="mint"
            icon={<WalletIcon size={22} />}
            title={t('child.moneyReceived.title', { amount: formatMoney(item.amountPence ?? 0) })}
            description={t('child.moneyReceived.description')}
            onPress={() => navigate('/wallet')}
          />
        );
      case 'next_quest':
        return (
          <LivingHomeCard
            key={item.id}
            data-testid={FOCUS_TESTID[item.kind]}
            tone="brand"
            icon={<Sword size={22} />}
            title={t('child.nextQuest.title', { title: item.taskTitle })}
            description={t('child.nextQuest.description', { points: item.pointsReward ?? 0 })}
            trailing={
              <TactileButton size="sm" onClick={() => navigate('/tasks')}>
                {t('nav.tasks', { ns: 'common', defaultValue: 'Quests' })}
              </TactileButton>
            }
          />
        );
      case 'streak_keep':
        return (
          <LivingHomeCard
            key={item.id}
            data-testid={FOCUS_TESTID[item.kind]}
            tone="streak"
            icon={<Flame size={22} />}
            title={t('child.streakKeep.title', { days: item.streakDays ?? 0 })}
            description={t('child.streakKeep.description')}
            onPress={() => navigate('/tasks')}
          />
        );
      case 'reward_available':
        return (
          <LivingHomeCard
            key={item.id}
            data-testid={FOCUS_TESTID[item.kind]}
            tone="xp"
            icon={<Gift size={22} />}
            title={t('child.rewardAvailable.title', { title: String(item.rewardTitle ?? '') })}
            description={t('child.rewardAvailable.description')}
            onPress={() => navigate('/rewards')}
          />
        );
      case 'family_quest':
        return (
          <LivingHomeCard
            key={item.id}
            data-testid={FOCUS_TESTID[item.kind]}
            tone="family"
            icon={<Swords size={22} />}
            title={t('child.familyQuest.title', { title: item.challengeTitle })}
            description={t('child.familyQuest.description')}
            onPress={() => navigate('/tasks')}
          />
        );
    }
  };

  const coreResourcesFailed =
    bootstrapStatus &&
    (['tasks', 'members'] as const).some(resource => bootstrapStatus[resource] === 'error');

  if (coreResourcesFailed) {
    return (
      <div className="mx-auto max-w-md py-12 text-center" role="alert" data-testid="living-home-error">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-coral-50 text-coral-500">
          <AlertTriangle size={26} aria-hidden="true" />
        </span>
        <h2 className="text-card-title qk-text-primary">{t('errorTitle')}</h2>
        <p className="mt-1 text-body qk-text-secondary">{t('errorDescription')}</p>
        <TactileButton className="mt-5" onClick={() => retryFeature('tasks')} data-testid="living-home-retry">
          <RefreshCw size={16} aria-hidden="true" />
          {t('errorRetry')}
        </TactileButton>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8" data-testid="child-living-home">
      {/* ---- Hero: personal state ------------------------------------------ */}
      <Surface
        level="card"
        className="relative overflow-hidden rounded-hero p-6 text-white"
        style={{ background: 'linear-gradient(135deg, var(--qk-surface-hero-from), var(--qk-surface-hero-to))' }}
      >
        <div className="flex items-center gap-4">
          <CharacterFrame
            src={currentUser?.avatarUrl}
            fallback={currentUser?.displayName}
            size={76}
            hero
            aria-label={`${currentUser?.displayName ?? ''}'s character`}
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-title">{t('child.greeting', { name: currentUser?.displayName ?? '' })}</h1>
            <p className="mt-0.5 text-body opacity-80">{t('child.heroSubtitle')}</p>
          </div>
          <QuekiMascot state={mascotState} size={72} className="shrink-0 drop-shadow-lg max-sm:hidden" />
        </div>

        {/* Level + XP progress — gold identity. */}
        <div className="mt-5 rounded-card bg-white/10 p-4 backdrop-blur-sm" data-testid="child-xp-panel">
          <div className="flex items-center justify-between gap-3">
            <XPDisplay total={gamification.xpTotal} level={gamification.level} compact />
            <StreakDisplayHero days={gamification.currentStreak} />
          </div>
          <ProgressBar
            className="mt-3 bg-white/20"
            tone="xp"
            value={
              gamification.isAvailable && gamification.xpToNextLevel > 0
                ? (gamification.xpProgressInLevel / (gamification.xpProgressInLevel + gamification.xpToNextLevel)) * 100
                : 0
            }
            aria-label="Level progress"
          />
          <p className="mt-1.5 text-meta opacity-80">
            {gamification.isAvailable
              ? `${gamification.xpToNextLevel} XP to level ${gamification.level + 1}`
              : t('loading')}
          </p>
        </div>

        {/* Points vs wallet — deliberately different rows, never interchangeable. */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <PointsDisplayOnBrand points={currentUser?.rewardPoints ?? 0} />
          {myWallet != null && (
            <button
              onClick={() => navigate('/wallet')}
              className="inline-flex items-center gap-2 rounded-full bg-mint-50 py-1 pl-1.5 pr-3 hover:bg-mint-100 active:bg-mint-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-500"
              data-testid="child-balance-chip"
              aria-label={t('child.openWallet', { balance: formatMoney(Number(myWallet?.balance ?? 0)) })}
            >
              <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-mint-500 text-white">
                <WalletIcon size={13} />
              </span>
              <span className="font-balance text-base tabular-nums font-extrabold text-mint-700">
                {formatMoney(Number(myWallet?.balance ?? 0))}
              </span>
            </button>
          )}
        </div>
      </Surface>

      {/* ---- Dynamic focus (max 3) ----------------------------------------- */}
      <section aria-label={t('child.heroSubtitle')} className="space-y-3">
        {resourcesLoading ? (
          <>
            <div className="h-20 animate-pulse rounded-card qk-bg-inset" aria-hidden="true" />
            <div className="h-20 animate-pulse rounded-card qk-bg-inset" aria-hidden="true" />
          </>
        ) : focus.length > 0 ? (
          focus.map(renderFocus)
        ) : (
          <TactileCard className="flex items-center gap-4 p-4" data-testid="child-all-done">
            <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-xl bg-xp-50 text-xp-500">
              <PartyPopper size={22} />
            </span>
            <div>
              <p className="text-card-title qk-text-primary">{t('child.allDone.title')}</p>
              <p className="mt-0.5 text-meta qk-text-secondary">{t('child.allDone.description')}</p>
            </div>
          </TactileCard>
        )}
      </section>

      {/* Mascot encouragement strip */}
      <div className="flex items-center gap-3 rounded-card qk-bg-card qk-border-subtle qk-shadow-card border p-4">
        <QuekiMascot state={mascotState === 'celebration' ? 'celebration' : 'encouraging'} size={56} />
        <p className="text-body font-semibold qk-text-primary">
          {mascotState === 'celebration' ? t('child.mascotCelebrate') : t('child.mascotEncourage')}
        </p>
      </div>
    </div>
  );
}

/** Streak rendered on the brand gradient — flame keeps its orange identity. */
function StreakDisplayHero({ days }: { days: number }) {
  const lit = days > 0;
  return (
    <div className="flex items-center gap-2" aria-label={`${days} day streak`}>
      <span
        aria-hidden="true"
        className={`flex h-8 w-8 items-center justify-center rounded-xl ${lit ? 'bg-streak-500 text-white' : 'bg-white/15 text-white/70'}`}
      >
        <Flame size={18} className={lit ? 'fill-current' : ''} />
      </span>
      <span className="font-balance tabular-nums">{days}</span>
    </div>
  );
}

function PointsDisplayOnBrand({ points }: { points: number }) {
  return (
    <span className="inline-flex items-center gap-2" aria-label={`${points} points`}>
      <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-xl bg-xp-500 text-white">
        <Star size={16} className="fill-current" />
      </span>
      <span className="font-balance tabular-nums">{points.toLocaleString()}</span>
      <span className="text-meta font-semibold uppercase tracking-wide opacity-75">pts</span>
    </span>
  );
}

