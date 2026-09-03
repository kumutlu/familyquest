import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronRight,
  RefreshCw,
  Wallet as WalletIcon,
  Sparkles,
  Star,
  ListChecks,
  Flame,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { adaptGamificationSummary } from '../../lib/gamificationAdapters';
import { formatMoney } from '../../lib/walletPresentation';
import { TactileCard } from '../queki/TactileCard';
import { TactileButton } from '../queki/TactileButton';
import { XPDisplay } from '../queki/semanticDisplays';
import { ProgressBar } from '../queki/Progress';
import { XpPop } from '../queki/XpPop';
import type { MysteryDropDisplay } from '../queki/TodaysAdventure';
import { MysteryReveal } from '../queki/MysteryReveal';
import { ChildExperienceShell } from '../experience/ChildExperienceShell';
import { QuestTileList } from '../experience/QuestTile';
import { TodaysAdventureCenterpiece } from '../experience/TodaysAdventureCenterpiece';
import { MascotBridge } from '../experience/MascotBridge';
import { YourJourney } from '../experience/YourJourney';
import { useMascotPresentationFor } from '../../hooks/useMascotPresentation';
import { useChildAdventure } from '../../hooks/useChildAdventure';
import { useExperienceTheme } from '../../hooks/useExperienceTheme';
import type { MascotContext } from '../../domain/mascot';
import type { TaskSummary } from '../../domain/engagement/resolver';
import type { MysteryDropReward } from '../../domain/mysteryDrop/types';
import type { MysteryDropResolverInput } from '../../domain/mysteryDrop/types';
import {
  acknowledgeComebackCompletion,
  acknowledgeMysteryReveal,
  isComebackCompletionAcknowledged,
  isMysteryRevealAcknowledged,
} from '../../lib/presentation/acknowledgement.v1';
import { localDateKey } from '../../domain/comeback/types';
import { evaluateMysteryDropEligibility } from '../../domain/mysteryDrop/eligibility';
import { unstable_DevOnlyPreviewRoute } from '../preview/EngagementPreviewRoute';

/**
 * Child Living Home — Queki V2 (2026-09-02).
 *
 * Composition (top → bottom):
 *   1. Identity / Progression hero  — XP, level, points, wallet
 *   2. Mascot bridge                — Queki between hero and Adventure
 *   3. TODAY › Today's Adventure    — surge / mystery / comeback / seasonal / normal
 *   4. TODAY › Today's Quests       — max 3, hold-to-complete elsewhere
 *   5. LONG TERM › Your journey     — Pet Box + Current Goal side-by-side
 *
 * Architectural rules
 * -------------------
 *   - NEVER awards XP / points / wallet. NEVER mutates Pet Box money.
 *   - NEVER introduces a second quest-completion path. Tapping a quest
 *     row navigates to /tasks where the existing hold-to-complete flow
 *     owns the authoritative completion.
 *   - Adventure precedence is delegated to the pure resolver — the host
 *     does NOT re-derive precedence.
 *   - Mascot mood is resolved by the Mascot Engine; this file only
 *     forwards the bundle to the renderer.
 *   - Mystery Drop is awarded AUTHORITATIVELY by the gamification
 *     processor. The host only opens the reveal; never invents a reward.
 *   - The "Skip" affordance from the mockup is NOT implemented. There is
 *     no canonical Skip behaviour in the production engagement model, so
 *     removing it removes a fake interaction and reclaims the primary
 *     Adventure action's prominence.
 *   - The world/weekly/seasonal theme is FELT through the existing token
 *     cascade and mascot costume. NO additional Home banner is rendered.
 */

const MAX_QUEST_PREVIEWS = 3;

interface MysteryDropHost {
  readonly definition: MysteryDropResolverInput['drop'];
  readonly isRevealReady: boolean;
  readonly progressLabel?: string;
  readonly resolvedReward: MysteryDropReward | null;
  readonly id: string;
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

  // Resources are considered loading only when the host has not yet
  // produced an authoritative state. The composition suppresses the
  // special-opportunity ladder until then.
  const resourcesLoading =
    !bootstrapStatus ||
    (['tasks', 'members'] as const).some(
      resource => bootstrapStatus[resource] === 'loading' || bootstrapStatus[resource] === 'idle',
    );

  const experienceTheme = useExperienceTheme();

  // ----- Adventure Tasks (read-only view of canonical `tasks`) ----------
  const adventureTasks: TaskSummary[] = useMemo(() => {
    return (Array.isArray(tasks) ? tasks : []).map(task => ({
      id: String(task?.id ?? ''),
      title: String(task?.title ?? ''),
      pointsReward: Number(task?.pointsReward ?? 0),
      assigneeId: task?.assigneeId ?? null,
      isCompleted: Boolean(task?.isCompleted),
    }));
  }, [tasks]);

  // ----- Mystery Drop host (read-only projection) -----------------------
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

  const mysteryDropInput = useMemo(() => {
    if (!mysteryDropHost) return null;
    return {
      id: mysteryDropHost.id,
      rarity: mysteryDropHost.definition.rarity ?? ('common' as const),
      isRevealReady: mysteryDropHost.isRevealReady,
    };
  }, [mysteryDropHost]);

  // ----- Mystery reveal acknowledgement ---------------------------------
  const [mysteryRevealOpen, setMysteryRevealOpen] = useState(false);
  const [pendingReward, setPendingReward] = useState<MysteryDropReward | null>(null);

  // ----- XP-pop feedback -----------------------------------------------
  const [xpPop, setXpPop] = useState<{
    amount: number;
    visible: boolean;
    variant: 'generic' | 'mystery' | 'comeback' | 'reverse';
  }>({ amount: 0, visible: false, variant: 'generic' });
  const xpAward = store.lastXpAward ?? null;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- We trigger on event id only.
  useEffect(() => {
    if (!xpAward || typeof xpAward.id !== 'string') return;
    setXpPop({
      amount: Number.isFinite(xpAward.amount) ? Number(xpAward.amount) : 0,
      visible: true,
      variant: xpAward.kind === 'mystery'
        ? 'mystery'
        : xpAward.kind === 'comeback'
          ? 'comeback'
          : 'generic',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xpAward?.id]);

  // ----- Adventure bundle (precedence delegated to the resolver) --------
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
    resolved: !resourcesLoading,
    seasonalActive: experienceTheme.seasonalEvent != null || experienceTheme.weeklyEvent != null,
  });

  // ----- Comeback completion acknowledgement ----------------------------
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
    if (prev === true) return;
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
    if (!reward) return;
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
    if (!eligibility.eligible) return;
    setPendingReward(reward);
    setMysteryRevealOpen(true);
  }, [mysteryDropHost, currentUser?.id]);

  const handleCloseMystery = useCallback(() => {
    setMysteryRevealOpen(false);
    if (mysteryDropHost) acknowledgeMysteryReveal(mysteryDropHost.id);
    setPendingReward(null);
  }, [mysteryDropHost]);

  // ----- Mascot Engine (read-only bundle) ------------------------------
  const mascotContext: Omit<MascotContext, 'now'> = useMemo(() => {
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
      child: { displayName: currentUser?.displayName },
      activity: {
        lastActiveAt,
        currentStreak: gamification.currentStreak ?? 0,
        questsRemaining: Array.isArray(tasks) ? tasks.length : 0,
        questsCompletedToday:
          gamification.todayProgress != null ? Math.round(gamification.todayProgress) : 0,
        allQuestsCompleted: false,
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
    adventure.surge,
    adventure.urgency,
  ]);

  const mascotPresentation = useMascotPresentationFor(mascotContext);

  // ----- Today's Quests (preview list, max 3) ---------------------------
  const questPreviewItems = useMemo(() => {
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
      .filter((q: any) => q.id.length > 0)
      .slice(0, MAX_QUEST_PREVIEWS);
  }, [tasks, taskCompletions, currentUser?.id]);

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

  // ----- Reward proximity (contextual, secondary to Adventure) ---------
  // We surface a compact proximity chip when a reward is within reach but
  // NOT a giant disconnected Home card.
  const rewardProximityItem = useMemo(() => {
    if (!Array.isArray(rewards) || rewards.length === 0) return null;
    const pts = Number(currentUser?.rewardPoints ?? 0);
    const eligible = rewards
      .filter((r: any) => Number(r?.pointsCost ?? 0) > 0 && Number(r?.pointsCost ?? 0) <= pts)
      .sort((a: any, b: any) => Number(a?.pointsCost ?? 0) - Number(b?.pointsCost ?? 0));
    if (eligible.length === 0) return null;
    return eligible[0];
  }, [rewards, currentUser?.rewardPoints]);

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

  // Theme accent is fed into the surface style so the world visibly
  // shifts for base / weekly / seasonal states. The ambient token is
  // already applied by the existing `ChildExperienceShell`.
  const themeAccent = experienceTheme.theme?.tokens?.accent as string | undefined;
  const surfaceStyle = themeAccent
    ? ({ ['--qk-theme-accent' as any]: themeAccent } as React.CSSProperties)
    : undefined;

  const previewSlot = unstable_DevOnlyPreviewRoute();

  return (
    <ChildExperienceShell
      resolvedTheme={experienceTheme ?? null}
      mascotPresentation={mascotPresentation.presentation}
    >
      <div
        className="qk-v2-stack"
        data-testid="child-living-home"
        style={surfaceStyle}
        data-child-home-version="v2"
      >
        {previewSlot}

        {/* ============================================================== */}
        {/* LEAD: Identity + Mascot + Adventure (full-width, top of page)    */}
        {/* ============================================================== */}
        <div className="qk-v2-stack__lead">
          {/* 1. Identity / Progression hero */}
          <section
            aria-label={t('child.heroAria', { defaultValue: 'Your identity and progression' })}
            data-testid="child-identity-hero"
            className="qk-hero"
          >
            <div className="relative z-10 flex flex-col gap-3 p-4 sm:p-5">
              <header className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="qk-section-eyebrow">
                    {t('child.identityGreeting', { defaultValue: 'Hello' })}
                  </p>
                  <h1
                    className="text-title font-extrabold tracking-tight"
                    data-testid="child-identity-name"
                  >
                    {currentUser?.displayName ?? ''}
                  </h1>
                </div>
                <div className="flex items-center gap-2">
                  {gamification.isAvailable ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-full qk-bg-subtle px-2.5 py-0.5 text-meta font-bold tabular-nums qk-text-primary"
                      data-testid="child-level-chip"
                      aria-label={t('child.levelAria', {
                        level: gamification.level,
                        defaultValue: `Level ${gamification.level}`,
                      })}
                    >
                      {t('child.levelLabel', { defaultValue: 'Lv' })} {gamification.level}
                    </span>
                  ) : null}
                  {gamification.isAvailable && gamification.currentStreak > 0 ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-streak-500/95 px-2.5 py-0.5 text-meta font-extrabold text-white"
                      data-testid="child-streak-chip"
                      aria-label={t('child.streakAria', {
                        days: gamification.currentStreak,
                        defaultValue: `${gamification.currentStreak} day streak`,
                      })}
                    >
                      <Flame size={12} aria-hidden="true" className="fill-current" />
                      {gamification.currentStreak}
                    </span>
                  ) : null}
                </div>
              </header>

              {/* XP progress */}
              <div className="qk-hero__panel p-3" data-testid="child-xp-panel">
                <XPDisplay
                  total={gamification.xpTotal}
                  level={gamification.level}
                  compact
                  className="qk-text-primary"
                />
                <ProgressBar
                  className="mt-2"
                  tone="xp"
                  value={
                    gamification.isAvailable && gamification.xpToNextLevel > 0
                      ? (gamification.xpProgressInLevel /
                          (gamification.xpProgressInLevel + gamification.xpToNextLevel)) * 100
                      : 0
                  }
                  aria-label={t('child.xpAria', { defaultValue: 'Level progress' })}
                />
                <p className="mt-1 text-meta qk-text-secondary">
                  {gamification.isAvailable
                    ? t('child.xpToNext', {
                        xp: gamification.xpToNextLevel,
                        level: gamification.level + 1,
                        defaultValue: `${gamification.xpToNextLevel} XP to level ${gamification.level + 1}`,
                      })
                    : t('loading')}
                </p>
              </div>

              {/* Points vs wallet — kept on separate rows, never interchangeable. */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  className="inline-flex items-center gap-1.5"
                  data-testid="child-points-chip"
                  aria-label={t('child.pointsAria', {
                    count: currentUser?.rewardPoints ?? 0,
                    defaultValue: `${currentUser?.rewardPoints ?? 0} points`,
                  })}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-xp-500 text-white"
                  >
                    <Star size={14} className="fill-current" />
                  </span>
                  <span className="font-balance tabular-nums">
                    {(currentUser?.rewardPoints ?? 0).toLocaleString()}
                  </span>
                  <span className="text-meta font-bold uppercase tracking-wide qk-text-secondary">
                    {t('child.ptsLabel', { defaultValue: 'pts' })}
                  </span>
                </span>
                {myWallet != null ? (
                  <button
                    type="button"
                    onClick={() => navigate('/wallet')}
                    data-testid="child-balance-chip"
                    aria-label={t('child.openWallet', {
                      balance: formatMoney(Number(myWallet?.balance ?? 0)),
                    })}
                    className="inline-flex items-center gap-2 rounded-full bg-mint-500 py-1 pl-1.5 pr-3 text-white hover:bg-mint-600 active:bg-mint-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-300"
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-mint-600"
                    >
                      <WalletIcon size={13} />
                    </span>
                    <span className="font-balance text-base tabular-nums font-extrabold">
                      {formatMoney(Number(myWallet?.balance ?? 0))}
                    </span>
                  </button>
                ) : null}
              </div>

              {rewardProximityItem ? (
                <button
                  type="button"
                  onClick={() => navigate('/rewards')}
                  data-testid="child-reward-proximity"
                  aria-label={t('child.rewardProximityAria', {
                    title: String(rewardProximityItem?.title ?? ''),
                    defaultValue: `Reward available: ${String(rewardProximityItem?.title ?? '')}`,
                  })}
                  className="qk-reward-proximity mt-1 self-start focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                >
                  <Sparkles size={12} aria-hidden="true" />
                  {t('child.rewardProximity', {
                    title: String(rewardProximityItem?.title ?? ''),
                    defaultValue: `Reward ready: ${String(rewardProximityItem?.title ?? '')}`,
                  })}
                  <ChevronRight size={12} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </section>

          {/* 2. Mascot bridge (engine-driven, character enters the scene)   */}
          <MascotBridge
            presentation={mascotPresentation.presentation}
            message={mascotPresentation.message}
            greeting={t('child.mascot.greetingPrefix', {
              name: currentUser?.displayName ?? '',
              defaultValue: 'Hi',
            })}
          />

          {/* 3. TODAY › Today's Adventure                                    */}
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
              normalQuestCount={questPreviewItems.filter((q: any) => q.isCompletedToday !== true).length}
              allCaughtUp={adventure.presentation.kind === 'normal' &&
                questPreviewItems.every((q: any) => q.isCompletedToday !== true)}
              onSelectSurgeTask={handleSelectSurgeTask}
              onPressMysteryDrop={handlePressMystery}
              onViewQuests={() => navigate('/tasks')}
            />
          </div>
        </div>

        {/* ============================================================== */}
        {/* LOWER: Today's Quests (group) + Your Journey (side-by-side)    */}
        {/* At md+ these become a horizontal grid; on mobile they stack.   */}
        {/* ============================================================== */}
        <div className="qk-v2-stack__lower">
          {/* 4. TODAY › Today's Quests (max 3, ONE coherent surface) */}
          {questPreviewItems.length > 0 ? (
            <section
              aria-label={t('child.quests.heading', { defaultValue: "Today's Quests" })}
              data-testid="todays-quests"
            >
              <header className="qk-section-eyebrow mb-1.5 flex items-center gap-2 px-1">
                <ListChecks size={14} aria-hidden="true" />
                <span className="flex-1">{t('child.quests.today', { defaultValue: "TODAY'S QUESTS" })}</span>
                {/* Canonical "See all" navigation affordance for the
                    Today's Quests list. PO 2026-09-03: only ONE affordance
                    per list lives in the heading (no duplicate footer). */}
                <button
                  type="button"
                  onClick={() => navigate('/tasks')}
                  data-testid="todays-quests-see-all"
                  aria-label={t('child.quests.todaySeeAllAria', { defaultValue: 'See all quests' })}
                  className="text-meta font-bold uppercase tracking-wide text-family-600 hover:text-family-700 focus:outline-none focus-visible:underline"
                >
                  {t('child.quests.seeAll', { defaultValue: 'See all' })} →
                </button>
              </header>
              <div className="qk-quest-group">
                <QuestTileList
                  quests={questPreviewItems.map((q: any) => ({
                    id: q.id,
                    title: q.title,
                    pointsReward: q.pointsReward,
                    isCompletedToday: q.isCompletedToday,
                    onPress: handleSelectSurgeTask,
                  }))}
                  onPressQuest={handleSelectSurgeTask}
                />
              </div>
            </section>
          ) : null}

          {/* 5. LONG TERM › Your Journey (Pet Box + Current Goal, side-by) */}
          <YourJourney familyData={(store as any).familyData} />
        </div>

        {/* ============================================================== */}
        {/* Reward feedback (XP pop · Mystery reveal)                       */}
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
      </div>
    </ChildExperienceShell>
  );
}

/** A small accessible TactileCard surface to keep the "all caught up" state cohesive. */
export function ChildAllCaughtUp() {
  const { t } = useTranslation('home');
  return (
    <TactileCard className="flex items-center gap-3 p-3" data-testid="child-all-done">
      <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-xl bg-mint-50 text-mint-600 dark:bg-mint-50 dark:text-mint-200">
        <Sparkles size={18} />
      </span>
      <div>
        <p className="text-card-title qk-text-primary">{t('child.allDone.title')}</p>
        <p className="mt-0.5 text-meta qk-text-secondary">{t('child.allDone.description')}</p>
      </div>
    </TactileCard>
  );
}

export default ChildLivingHome;
