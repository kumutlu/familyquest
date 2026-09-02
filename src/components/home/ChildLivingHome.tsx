import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Hourglass,
  Wallet as WalletIcon,
  Sword,
  Flame,
  Gift,
  Swords,
  PartyPopper,
  AlertTriangle,
  RefreshCw,
  ListChecks,
  Star,
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
import { TodaysAdventure, type MysteryDropDisplay } from '../queki/TodaysAdventure';
import { XpPop } from '../queki/XpPop';
import { MysteryReveal } from '../queki/MysteryReveal';
import { ChildExperienceShell } from '../experience/ChildExperienceShell';
import { MascotScene } from '../experience/MascotScene';
import { LongTermProgress } from '../experience/LongTermProgress';
import { QuestTileList } from '../experience/QuestTile';
import { TodaysAdventureCenterpiece } from '../experience/TodaysAdventureCenterpiece';
import { useMascotPresentationFor } from '../../hooks/useMascotPresentation';
import { useChildAdventure } from '../../hooks/useChildAdventure';
import { useExperienceTheme } from '../../hooks/useExperienceTheme';
import type { MascotContext } from '../../domain/mascot';
import type { TaskSummary } from '../../domain/engagement/resolver';
import type { MysteryDropReward } from '../../domain/mysteryDrop/types';
import type {
  MysteryDropResolverInput,
} from '../../domain/mysteryDrop/types';
import {
  acknowledgeComebackCompletion,
  acknowledgeMysteryReveal,
  isComebackCompletionAcknowledged,
  isMysteryRevealAcknowledged,
} from '../../lib/presentation/acknowledgement.v1';
import {
  localDateKey,
} from '../../domain/comeback/types';
import {
  evaluateMysteryDropEligibility,
} from '../../domain/mysteryDrop/eligibility';
import {
  unstable_DevOnlyPreviewRoute,
} from '../preview/EngagementPreviewRoute';

/**
 * Child Living Home — Queki v2 Wave 1 + Engagement Experience V1.
 *
 * Personal state first (character, level, XP, streak, points, wallet), then
 * the V1 Engagement Experience layers in this fixed order:
 *
 *   1. Mascot strip              (welcome + mood)
 *   2. Today's Adventure         (Surge · Mystery Drop · Comeback · Normal)
 *   3. Today's Quests            (preview of the most relevant quests)
 *   4. XP / Level Progress       (level hero + XP pop feedback)
 *   5. Reward feedback overlays  (Mystery reveal · XP pop)
 *
 * XP / points / real money each keep their own semantic identity.
 * No history feeds.
 *
 * Mystery Drop authority
 * ----------------------
 * The Mystery Drop is awarded AUTHORITATIVELY by the gamification
 * processor when the qualifying completion is approved. This host
 * treats `MysteryOpen` as PRESENTATION ONLY: when a child taps OPEN,
 * we render the already-authoritative reward that the resolver has
 * already produced. The client NEVER invents a reward amount.
 */

const FOCUS_TESTID: Record<ChildFocus['kind'], string> = {
  approval_waiting: 'focus-approval-waiting',
  money_received: 'focus-money-received',
  next_quest: 'focus-next-quest',
  streak_keep: 'focus-streak',
  reward_available: 'focus-reward',
  family_quest: 'focus-family-quest',
};

const MAX_QUEST_PREVIEWS = 3;

interface MysteryDropHost {
  /** Definition needed for the pure resolver. */
  readonly definition: MysteryDropResolverInput['drop']
  /** Whether the drop is currently reveal-ready. */
  readonly isRevealReady: boolean
  /** Optional override progress label for the locked state. */
  readonly progressLabel?: string
  /** Resolved reward from the authoritative award path. */
  readonly resolvedReward: MysteryDropReward | null
  /** Mystery drop id used for acknowledgement. */
  readonly id: string
}

export function ChildLivingHome() {
  const { t } = useTranslation('home');
  const navigate = useNavigate();
  const store = useStore() as any;
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
    mysteryDropDefinition,
    comebackXpReward,
    familyTimezone,
  } = store;

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

  // Theme — applied via the experience theme hook. The surface CSS
  // variables are bound to the resolved theme so the world visibly
  // shifts for base / weekly / seasonal / child-equipped states.
  const experienceTheme = useExperienceTheme();

  // ----- Engagement Experience V1 --------------------------------------
  const adventureTasks: TaskSummary[] = useMemo(() => {
    return (Array.isArray(tasks) ? tasks : []).map(task => ({
      id: String(task?.id ?? ''),
      title: String(task?.title ?? ''),
      pointsReward: Number(task?.pointsReward ?? 0),
      assigneeId: task?.assigneeId ?? null,
      isCompleted: Boolean(task?.isCompleted),
    }));
  }, [tasks]);

  // Build the Mystery Drop display from the host-provided authoritative
  // definition + reward. When the server has not surfaced a drop, the
  // entire field stays null and the resolver can show normal / seasonal.
  const mysteryDropHost: MysteryDropHost | null = useMemo(() => {
    if (!mysteryDropDefinition || !currentUser) return null;
    const resolved = mysteryDropDefinition.resolvedReward ?? null;
    const progress = typeof mysteryDropDefinition.progressLabel === 'string'
      ? mysteryDropDefinition.progressLabel
      : undefined;
    return {
      definition: mysteryDropDefinition.definition,
      isRevealReady: mysteryDropDefinition.isRevealReady === true,
      progressLabel: progress,
      resolvedReward: resolved,
      id: mysteryDropDefinition.definition.id,
    };
  }, [mysteryDropDefinition, currentUser]);

  // Resolve a Mystery Drop input for the resolver hook. The hook treats
  // isRevealReady from the host as authoritative — the same flag the
  // gamification processor sets after the awarding transaction.
  const mysteryDropInput = useMemo(() => {
    if (!mysteryDropHost) return null;
    return {
      id: mysteryDropHost.id,
      rarity: mysteryDropHost.definition.rarity ?? ('common' as const),
      isRevealReady: mysteryDropHost.isRevealReady,
    };
  }, [mysteryDropHost]);

  // ----- Mystery reveal acknowledgement ---------------------------------
  // UI state only: never reward authority. The host opens the reveal the
  // first time the child taps OPEN, and remembers the ack so subsequent
  // remounts render the owned beat (no replay).
  const [mysteryRevealOpen, setMysteryRevealOpen] = useState(false);
  const [pendingReward, setPendingReward] = useState<MysteryDropReward | null>(null);

  // ----- XP-pop feedback -----------------------------------------------
  // The XP pop is sourced from AUTHORITATIVE gamification_events. We
  // track the last seen award event id so we never replay. The amount
  // and variant come from authoritative metadata; the host never invents
  // them. For V1 the host receives the most recent award via the store
  // (`lastXpAward`) which is a presentation-side cache keyed by event id.
  const [xpPop, setXpPop] = useState<{
    amount: number;
    visible: boolean;
    variant: 'generic' | 'mystery' | 'comeback' | 'reverse';
  }>({ amount: 0, visible: false, variant: 'generic' });

  const xpAward = store.lastXpAward ?? null;

  // eslint-disable-next-line react-hooks/exhaustive-deps -- We trigger on event id only.
  useEffect(() => {
    if (!xpAward || typeof xpAward.id !== 'string') return;
    // The store hands us a fresh award event; trigger exactly one pop.
    setXpPop({
      amount: Number.isFinite(xpAward.amount) ? Number(xpAward.amount) : 0,
      visible: true,
      variant: xpAward.kind === 'mystery'
        ? 'mystery'
        : xpAward.kind === 'comeback'
          ? 'comeback'
          : 'generic',
    });
    // We only trigger on the event id, intentionally. The full award
    // object may change reference between renders without producing a
    // new logical event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xpAward?.id]);

  const adventure = useChildAdventure({
    now: Date.now(),
    activeSurges: store.activeSurges ?? [],
    availableTasks: adventureTasks,
    surgeHoursEnabled: true,
    currentStreak: gamification.currentStreak,
    questsRemaining: adventureTasks.filter(task => !task.isCompleted).length,
    questsCompletedToday: gamification.todayProgress != null
      ? Math.round(gamification.todayProgress)
      : 0,
    activeEventId: null,
    comeback: store.comebackInput ?? null,
    mysteryDrop: mysteryDropInput,
    // Resolved only when the bootstrap has settled; otherwise we
    // suppress the entire precedence ladder and the surface stays calm.
    resolved: !resourcesLoading,
    seasonalActive: experienceTheme.seasonalEvent != null || experienceTheme.weeklyEvent != null,
  });

  // ----- Comeback completion acknowledgement ----------------------------
  // Source of truth for comeback XP is the `COMEBACK_MISSION_XP_AWARDED`
  // gamification event. We surface a one-shot XP pop when a NEW
  // completion arrives — same mechanism as Mystery reveal, but the key
  // includes the local date so the same tier can celebrate again on a
  // new day.
  const comebackTier = adventure.comeback?.tier ?? 'none';
  const comebackCompleted = adventure.comeback?.missionCompleted === true;
  const prevComebackCompletedRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!comebackCompleted) {
      prevComebackCompletedRef.current = false;
      return;
    }
    const prev = prevComebackCompletedRef.current;
    prevComebackCompletedRef.current = true;
    if (prev === true) return; // already acknowledged in this mount
    const tz = typeof familyTimezone === 'string' ? familyTimezone : 'UTC';
    const localDate = localDateKey(Date.now(), tz);
    const key = `${currentUser?.id ?? ''}|${localDate}|${comebackTier}`;
    if (isComebackCompletionAcknowledged(key)) return;
    acknowledgeComebackCompletion(key);
    const xp = Number(comebackXpReward) || 0;
    if (xp > 0) {
      setXpPop({ amount: xp, visible: true, variant: 'comeback' });
    }
  }, [comebackCompleted, comebackTier, currentUser?.id, comebackXpReward, familyTimezone]);

  const handleSelectSurgeTask = useCallback((taskId: string) => {
    navigate(`/tasks?focus=${encodeURIComponent(taskId)}`);
  }, [navigate]);

  const handlePressMystery = useCallback((dropId: string) => {
    const host = mysteryDropHost;
    if (!host || host.id !== dropId) return;
    const reward = host.resolvedReward;
    // Defense in depth: a reward is required. If the host never set
    // one, we never let OPEN mint anything.
    if (!reward) return;
    // Re-run the pure resolver with the most recent completion to be
    // sure the drop is still in its eligible window before we reveal.
    const completedAt = Date.now();
    const eligibility = evaluateMysteryDropEligibility({
      drop: host.definition,
      completion: {
        id: `${host.id}__reveal`,
        childId: currentUser?.id ?? '',
        taskId: 'any',
        completedAt,
        requiresApproval: false,
      },
    });
    // If the resolver is not currently eligible, refuse to reveal —
    // we never present a celebration without authoritative backing.
    if (!eligibility.eligible) return;
    setPendingReward(reward);
    setMysteryRevealOpen(true);
  }, [mysteryDropHost, currentUser?.id]);

  const handleCloseMystery = useCallback(() => {
    setMysteryRevealOpen(false);
    if (mysteryDropHost) acknowledgeMysteryReveal(mysteryDropHost.id);
    setPendingReward(null);
  }, [mysteryDropHost]);

  // ----- Mascot Engine V1 ----------------------------------------------
  const mascotContext: Omit<MascotContext, 'now'> = useMemo(() => {
    const childDisplayName = currentUser?.displayName;
    const streak = gamification.currentStreak ?? 0;
    const allDone = focus.length === 0 && !resourcesLoading;
    const lastActiveAt = (() => {
      const ms = Date.now();
      if (Array.isArray(taskCompletions) && taskCompletions.length > 0) {
        const sorted = [...taskCompletions].sort((a: any, b: any) => {
          const ta = typeof a?.completedAt === 'number' ? a.completedAt : Number.MAX_SAFE_INTEGER;
          const tb = typeof b?.completedAt === 'number' ? b.completedAt : Number.MAX_SAFE_INTEGER;
          return tb - ta;
        });
        const top = sorted[0];
        if (top && typeof top.completedAt === 'number') return top.completedAt;
      }
      return ms;
    })();
    return {
      child: { displayName: childDisplayName },
      activity: {
        lastActiveAt,
        currentStreak: streak,
        questsRemaining: Array.isArray(tasks) ? tasks.length : 0,
        questsCompletedToday:
          gamification.todayProgress != null ? Math.round(gamification.todayProgress) : 0,
        allQuestsCompleted: allDone && streak > 0,
      },
      engagement: {
        activeSurge: adventure.surge !== null,
        surgeEndingSoon: adventure.urgency === 'ending',
      },
    };
  }, [
    currentUser?.displayName,
    gamification.currentStreak,
    gamification.todayProgress,
    tasks,
    taskCompletions,
    focus.length,
    resourcesLoading,
    adventure.surge,
    adventure.urgency,
  ]);

  const mascotPresentation = useMascotPresentationFor(mascotContext);

  // ----- Today's Quests (V1 preview) -----------------------------------
  const questPreviewItems: QuestPreviewItem[] = useMemo(() => {
    const childId = currentUser?.id;
    const completedToday = new Set(
      (Array.isArray(taskCompletions) ? taskCompletions : [])
        .filter((c: any) => c?.childId === childId)
        .map((c: any) => c?.taskId),
    );
    return (Array.isArray(tasks) ? tasks : [])
      .filter((task: any) => task?.isActive !== false)
      .map((task: any) => ({
        id: String(task?.id ?? ''),
        title: String(task?.title ?? ''),
        pointsReward: Number(task?.pointsReward ?? 0),
        isCompletedToday: completedToday.has(String(task?.id ?? '')),
      }))
      .filter((q: QuestPreviewItem) => q.id.length > 0)
      .slice(0, MAX_QUEST_PREVIEWS);
  }, [tasks, taskCompletions, currentUser?.id]);

  // Build the Mystery Drop display for the surface.
  const mysteryDropDisplay: MysteryDropDisplay | null = useMemo(() => {
    if (!mysteryDropHost) return null;
    return {
      id: mysteryDropHost.id,
      rarity: mysteryDropHost.definition.rarity ?? ('common' as const),
      messageKey: 'child.adventure.mystery.lockedLead',
      isRevealReady: mysteryDropHost.isRevealReady,
      progressLabel: mysteryDropHost.progressLabel,
    };
  }, [mysteryDropHost]);

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

  // Map the active theme accent (if any) to CSS custom properties on the
  // root surface wrapper. The surface tokens are defined in
  // `src/design/tokens.css`; we layer the theme accent on top of them so
  // every child sees the world visibly shift for base / weekly /
  // seasonal / child-equipped.
  const themeAccent = experienceTheme.theme?.tokens?.accent as string | undefined;
  const surfaceStyle = themeAccent
    ? ({ ['--qk-theme-accent' as any]: themeAccent } as React.CSSProperties)
    : undefined;

  const allCaughtUp = adventure.presentation.kind === 'normal' &&
    questPreviewItems.every(q => q.isCompletedToday !== true || q.id.length === 0);

  // Dev-only preview harness. Renders nothing in production builds —
  // the component hard-fails when `import.meta.env.PROD` is true.
  const previewSlot = unstable_DevOnlyPreviewRoute();

  return (
    <ChildExperienceShell
      resolvedTheme={experienceTheme ?? null}
      mascotPresentation={mascotPresentation.presentation}
    >
      <div className="space-y-6 pb-8" data-testid="child-living-home" style={surfaceStyle}>
        {previewSlot}

      {/* ============================================================== */}
      {/* Hero: personal state                                            */}
      {/* ============================================================== */}
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

      {/* ============================================================== */}
      {/* Mascot composition (V1 welcome + mood) — replaces strip row    */}
      {/* ============================================================== */}
      <div data-testid="mascot-strip">
        <MascotScene
          presentation={mascotPresentation.presentation}
          message={mascotPresentation.message}
          greeting={t('child.greeting', { name: currentUser?.displayName ?? '' })}
        />
      </div>

      {/* ============================================================== */}
      {/* V1: Today's Adventure — productized centerpiece                */}
      {/* ============================================================== */}
      <div data-testid="todays-adventure" data-adventure-kind={adventure.presentation.kind}>
        <TodaysAdventureCenterpiece
          presentation={adventure.presentation}
          mysteryDrop={mysteryDropDisplay}
          comeback={adventure.comeback ? {
            tier: adventure.comeback.tier,
            inactivityDays: adventure.comeback.inactivityDays,
            missionCompleted: adventure.comeback.missionCompleted,
          } : null}
          surge={adventure.surge ? {
            surgeId: adventure.surge.surgeId,
            eligibleTasks: adventure.surge.eligibleTasks,
            endsAt: adventure.surge.window?.endsAt ?? Date.now(),
          } : null}
          normalQuestCount={questPreviewItems.filter(q => q.isCompletedToday !== true).length}
          allCaughtUp={allCaughtUp}
          onSelectSurgeTask={handleSelectSurgeTask}
          onPressMysteryDrop={handlePressMystery}
          onViewQuests={() => navigate('/tasks')}
        />
      </div>

      {/* ============================================================== */}
      {/* V1: Today's Quests (preview list, max 3)                       */}
      {/* ============================================================== */}
      {questPreviewItems.length > 0 && (
        <section
          aria-label={t('child.quests.heading')}
          data-testid="todays-quests"
          className="space-y-3"
        >
          <header className="flex items-center gap-2 px-1">
            <ListChecks size={16} aria-hidden="true" className="text-family-500" />
            <h2 className="text-card-title qk-text-primary">
              {t('child.quests.heading')}
            </h2>
          </header>
          <QuestTileList
            quests={questPreviewItems.map(q => ({
              id: q.id,
              title: q.title,
              pointsReward: q.pointsReward,
              isCompletedToday: q.isCompletedToday,
              onPress: handleSelectSurgeTask,
            }))}
            onPressQuest={handleSelectSurgeTask}
            onViewAll={() => navigate('/tasks')}
          />
        </section>
      )}

      {/* ============================================================== */}
      {/* V1: Reward feedback (XP pop · Mystery reveal)                 */}
      {/* ============================================================== */}
      <XpPop
        amount={xpPop.amount}
        visible={xpPop.visible}
        variant={xpPop.variant}
        className="fixed left-1/2 top-4 z-40 -translate-x-1/2"
      />

      <MysteryReveal
        open={mysteryRevealOpen}
        reward={pendingReward}
        rarity={mysteryDropHost?.definition.rarity ?? 'rare'}
        onClose={handleCloseMystery}
        acknowledged={mysteryDropHost ? isMysteryRevealAcknowledged(mysteryDropHost.id) : false}
      />

      {/* ============================================================== */}
      {/* Long-term progression band — Pet Box + Goals (preserved)        */}
      {/* ============================================================== */}
      <LongTermProgress familyData={(store as any).familyData} />

      {/* ============================================================== */}
      {/* Dynamic focus (max 3) — kept from Wave 1 for parent signal    */}
      {/* ============================================================== */}
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
      </div>
    </ChildExperienceShell>
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