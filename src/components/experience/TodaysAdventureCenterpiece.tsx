/**
 * <TodaysAdventureCenterpiece /> — the visual centerpiece of the daily loop.
 *
 * Wraps the existing `TodaysAdventure` precedence resolver output with
 * productized visual treatments:
 *
 *   - Surge:           orange/red gradient with a subtle halo + sparkles.
 *   - Mystery Ready:   gold gradient with a floating chest and a
 *                      "Tap to open" affordance that dominates the layout.
 *   - Mystery Locked:  calm progress chip, clearly less prominent than Ready.
 *   - Comeback:        warm welcome gradient (no guilt language).
 *   - Seasonal:        subtle family-tinted accent.
 *   - Normal:          calm "X quests waiting" affordance with mascot cue.
 *
 * Rules
 *   - NEVER invents XP / counts / countdown data. The host still passes
 *     `presentation` from the frozen precedence resolver; we only style.
 *   - The active state is selected by inspecting `presentation.kind`,
 *     which is already produced by the pure resolver. We do NOT re-derive
 *     precedence here.
 *   - All states are reachable; only the resolver decides which one
 *     surfaces today.
 */

import { useTranslation } from 'react-i18next';
import { Sparkles, PartyPopper, Gift, Timer } from 'lucide-react';
import { TactileButton } from '../queki/TactileButton';
import type {
  DailyAdventurePresentation,
} from '../../domain/adventure/presentation.v1';
import type { ComebackTier } from '../../domain/comeback/types';
import type { MysteryDropDisplay } from '../queki/TodaysAdventure';


/**
 * Map a comeback tier to its authored XP reward (matches the
 * authoritative gamification / Comeback eligibility resolver so the
 * Adventure band never invents its own number). Kept local so the
 * component file remains the single owner of presentation copy.
 */
function resolveComebackXp(tier: ComebackTier): number {
  if (tier === 'return_7d') return 50;
  if (tier === 'return_3d') return 25;
  if (tier === 'return_1d') return 10;
  return 0;
}

export interface TodaysAdventureCenterpieceProps {
  readonly presentation: DailyAdventurePresentation;
  readonly mysteryDrop?: MysteryDropDisplay | null;
  readonly comeback?: {
    readonly tier: ComebackTier;
    readonly inactivityDays: number;
    readonly missionCompleted: boolean;
  } | null;
  readonly surge?: {
    readonly surgeId: string;
    readonly eligibleTasks: ReadonlyArray<{ id: string; title: string; pointsReward: number }>;
    readonly endsAt: number;
  } | null;
  readonly normalQuestCount?: number;
  readonly allCaughtUp?: boolean;
  readonly onSelectSurgeTask?: (taskId: string) => void;
  readonly onPressMysteryDrop?: (dropId: string) => void;
  readonly onPressComeback?: () => void;
  readonly onViewQuests?: () => void;
}

/**
 * Render the centerpiece. Single function so the host can swap to a
 * different presentation product without re-rendering the page.
 */
export function TodaysAdventureCenterpiece({
  presentation,
  mysteryDrop,
  comeback,
  surge,
  normalQuestCount,
  allCaughtUp,
  onSelectSurgeTask,
  onPressMysteryDrop,
  onPressComeback,
  onViewQuests,
}: TodaysAdventureCenterpieceProps) {
  const { t } = useTranslation('home');

  if (presentation.kind === 'surge' && surge) {
    return <SurgeShell surge={surge} onSelectSurgeTask={onSelectSurgeTask} />;
  }
  if (presentation.kind === 'mystery_ready' && mysteryDrop) {
    return (
      <MysteryReadyShell
        drop={mysteryDrop}
        onOpen={() => onPressMysteryDrop?.(mysteryDrop.id)}
      />
    );
  }
  if (presentation.kind === 'mystery_available' && mysteryDrop) {
    return <MysteryLockedShell drop={mysteryDrop} />;
  }
  if (presentation.kind === 'comeback' && comeback) {
    return (
      <ComebackShell
        tier={comeback.tier}
        inactivityDays={comeback.inactivityDays}
        xpReward={resolveComebackXp(comeback.tier)}
        onPress={onPressComeback}
      />
    );
  }
  if (presentation.kind === 'seasonal') {
    return <SeasonalShell />;
  }
  // normal / loading
  return (
    <NormalShell
      questCount={normalQuestCount ?? 0}
      allCaughtUp={allCaughtUp === true}
      onViewQuests={onViewQuests}
      heading={t('child.adventure.heading')}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Surge                                                                     */
/* -------------------------------------------------------------------------- */

function SurgeShell({
  surge,
  onSelectSurgeTask,
}: {
  surge: TodaysAdventureCenterpieceProps['surge'];
  onSelectSurgeTask?: (id: string) => void;
}) {
  const { t } = useTranslation('home');
  if (!surge) return null;
  const task = surge.eligibleTasks[0];
  const minutesLeft = Math.max(0, Math.round((surge.endsAt - Date.now()) / 60_000));
  return (
    <section
      data-testid="adventure-centerpiece-surge"
      className="qk-surge-shell"
      aria-label={t('child.adventure.surge.aria')}
    >
      <div className="relative z-10 flex flex-col gap-3 text-white">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-meta font-bold uppercase tracking-wide">
            <Timer size={14} aria-hidden="true" />
            {minutesLeft > 0
              ? t('child.adventure.surge.minutesLeft', { count: minutesLeft })
              : t('child.adventure.endingSoon')}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/25 px-2.5 py-0.5 text-meta font-extrabold uppercase tracking-wide">
            {t('child.adventure.surge.bonusMultiplier')}
          </span>
        </div>
        <h3 className="text-card-title font-extrabold text-white">
          {t('child.adventure.surge.title')}
        </h3>
        {task ? (
          <div className="flex flex-col gap-2 rounded-2xl bg-white/15 p-3 backdrop-blur-sm">
            <p className="text-body font-bold text-white">{task.title}</p>
            <p className="text-meta text-white/85">
              {t('child.adventure.surge.worthLabel', {
                count: task.pointsReward,
              })}
            </p>
            {onSelectSurgeTask ? (
              <TactileButton
                variant="inverse"
                size="md"
                onClick={() => onSelectSurgeTask(task.id)}
              >
                {t('child.adventure.surge.startQuest')}
              </TactileButton>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Mystery Ready                                                              */
/* -------------------------------------------------------------------------- */

function MysteryReadyShell({
  drop,
  onOpen,
}: {
  drop: MysteryDropDisplay;
  onOpen: () => void;
}) {
  const { t } = useTranslation('home');
  return (
    <button
      type="button"
      data-testid="adventure-centerpiece-mystery-ready"
      data-mystery-rarity={drop.rarity}
      data-mystery-state="ready"
      onClick={onOpen}
      className="qk-mystery-ready group block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
      aria-label={t('child.adventure.mystery.readyAria')}
    >
      <div className="relative z-10 flex items-start gap-4">
        <div className="qk-mystery-ready__chest flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/30 text-amber-900 shadow-inner">
          <Gift size={32} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-meta font-extrabold uppercase tracking-wide text-amber-900">
            {t('child.adventure.mystery.readyEyebrow')}
          </p>
          <p className="mt-1 text-card-title font-extrabold text-amber-950">
            {t('child.adventure.mystery.readyTitle')}
          </p>
          <p className="mt-1 text-meta text-amber-900/80">
            {t('child.adventure.mystery.readyLead', { rarity: drop.rarity })}
          </p>
        </div>
        <span
          aria-hidden="true"
          className="rounded-full bg-amber-950 px-4 py-2 text-meta font-extrabold uppercase tracking-wide text-white shadow"
        >
          {t('child.adventure.mystery.readyAction')}
        </span>
      </div>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Mystery Locked                                                             */
/* -------------------------------------------------------------------------- */

function MysteryLockedShell({ drop }: { drop: MysteryDropDisplay }) {
  const { t } = useTranslation('home');
  return (
    <div
      data-testid="adventure-centerpiece-mystery-locked"
      data-mystery-rarity={drop.rarity}
      data-mystery-state="locked"
      className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900"
      role="group"
      aria-label={t('child.adventure.mystery.lockedTitle')}
    >
      <span
        aria-hidden="true"
        className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-200 text-amber-800"
      >
        <Sparkles size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-card-title font-extrabold text-amber-900">
          {t('child.adventure.mystery.lockedTitle')}
        </p>
        <p className="mt-0.5 text-meta text-amber-800">
          {t('child.adventure.mystery.lockedLead')}
        </p>
      </div>
      <span
        aria-hidden="true"
        className="rounded-full bg-amber-100 px-3 py-1 text-meta font-extrabold tabular-nums text-amber-900"
      >
        {drop.progressLabel ?? '0 / 1'}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Comeback                                                                   */
/* -------------------------------------------------------------------------- */

function ComebackShell({
  tier,
  inactivityDays,
  xpReward,
  onPress,
}: {
  tier: ComebackTier;
  inactivityDays: number;
  xpReward: number;
  onPress?: () => void;
}) {
  const { t } = useTranslation('home');
  // PO 2026-09-03: warm welcome on the mascot, authoritative mission/XP info
  // here. The mascot already says "Great to see you again" so the Adventure
  // does NOT repeat the welcome line. We surface the comeback XP + mission
  // so the child sees the actionable benefit.
  const tierCopy =
    tier === 'return_7d'
      ? t('child.adventure.comeback.warm7d')
      : tier === 'return_3d'
        ? t('child.adventure.comeback.warm3d')
        : t('child.adventure.comeback.warm1d');
  const xp = Math.max(0, Math.floor(Number.isFinite(xpReward) ? xpReward : 0));
  const body =
    inactivityDays === 1
      ? t('child.adventure.comeback.bodySingle', { xp })
      : t('child.adventure.comeback.body', { count: inactivityDays, xp });
  return (
    <div
      data-testid="adventure-centerpiece-comeback"
      data-comeback-tier={tier}
      data-comeback-state={xp > 0 ? 'has-xp' : 'no-xp'}
      className="flex items-center gap-3 rounded-2xl border border-family-100 bg-family-50/70 p-3"
      role={onPress ? 'button' : undefined}
      onClick={onPress}
      onKeyDown={onPress ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPress(); } }) : undefined}
      tabIndex={onPress ? 0 : undefined}
      aria-label={t('child.adventure.comeback.heading')}
    >
      <span
        aria-hidden="true"
        className="flex h-10 w-10 items-center justify-center rounded-xl bg-family-500 text-white"
      >
        <PartyPopper size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-meta font-extrabold uppercase tracking-wide text-family-700">
          {t('child.adventure.comeback.heading')}
        </p>
        <p className="mt-0.5 text-body font-bold text-family-900">
          {tierCopy}
          {xp > 0 ? (
            <span className="ml-2 inline-flex items-center rounded-full bg-family-500 px-2 py-0.5 text-meta font-extrabold uppercase tracking-wide text-white">
              +{xp} XP
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 text-meta text-family-800/80">{body}</p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Seasonal                                                                   */
/* -------------------------------------------------------------------------- */

function SeasonalShell() {
  const { t } = useTranslation('home');
  // Seasonal context is shown as secondary context — the daily anchor
  // "Today's Adventure" MUST always remain the dominant heading so the
  // child never loses the daily-loop orientation. The seasonal event
  // chip and accent confirm the world theme without replacing it.
  return (
    <div
      data-testid="adventure-centerpiece-seasonal"
      className="space-y-3 rounded-2xl border border-family-100 bg-family-50/50 p-4"
    >
      <header className="flex items-center gap-2">
        <Sparkles size={16} aria-hidden="true" className="text-xp-500" />
        <h2 className="text-card-title qk-text-primary">
          {t('child.adventure.heading')}
        </h2>
        <span
          data-testid="adventure-centerpiece-seasonal-chip"
          className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-family-500/15 px-2.5 py-0.5 text-meta font-extrabold uppercase tracking-wide text-family-700"
        >
          <PartyPopper size={12} aria-hidden="true" />
          {t('child.adventure.seasonal.chip')}
        </span>
      </header>
      <div className="flex items-center gap-3 rounded-xl border border-family-100 bg-family-50 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-card-title font-bold qk-text-primary">
            {t('child.adventure.seasonal.title')}
          </p>
          <p className="mt-0.5 text-meta qk-text-secondary">
            {t('child.adventure.seasonal.description')}
          </p>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Normal / All caught up                                                     */
/* -------------------------------------------------------------------------- */

function NormalShell({
  questCount,
  allCaughtUp,
  onViewQuests,
  heading,
}: {
  questCount: number;
  allCaughtUp: boolean;
  onViewQuests?: () => void;
  heading: string;
}) {
  const { t } = useTranslation('home');
  // COMPACT NORMAL ADVENTURE.
  // The normal day is intentionally calm and lightweight. We render a
  // single header row that introduces the day's activity and hands the
  // child straight to the quest group below. NO giant duplicate card,
  // NO "View quests" button that repeats the upcoming list. Special
  // states (Surge / Mystery / Comeback) keep their expanded treatment.
  return (
    <div
      aria-label={heading}
      data-testid="adventure-centerpiece-normal"
      data-normal-state={allCaughtUp ? 'all-caught-up' : 'quests-waiting'}
      className="qk-adventure-compact"
    >
      <Sparkles size={14} aria-hidden="true" className="text-xp-500 shrink-0" />
      <h2 className="qk-adventure-compact__title">{heading}</h2>
      <span aria-hidden="true" className="text-qk-text-secondary">·</span>
      <p className="qk-adventure-compact__body">
        {allCaughtUp
          ? t('child.normal.allCaughtUp')
          : t('child.normal.questCount', { count: questCount })}
      </p>
      {onViewQuests ? (
        <button
          type="button"
          onClick={onViewQuests}
          aria-label={t('child.adventure.viewQuestsAria', {
            defaultValue: "View today's quests",
          })}
          data-testid="adventure-centerpiece-normal-view"
          className="ml-auto text-meta font-bold uppercase tracking-wide text-family-600 hover:text-family-700 focus:outline-none focus-visible:underline"
        >
          {t('child.normal.viewQuests')}
        </button>
      ) : null}
    </div>
  );
}

export default TodaysAdventureCenterpiece;