import { useTranslation } from 'react-i18next';
import { Sparkles, ListChecks, PartyPopper, Gift } from 'lucide-react';
import { cn } from '../../lib/utils';
import { TactileCard } from './TactileCard';
import { TactileButton } from './TactileButton';
import { SurgeBanner } from '../surge/SurgeBanner';
import { ComebackMissionCard } from './ComebackMissionCard';
import type { TaskSummary } from '../../domain/engagement/resolver';
import type {
  SurgeEligibilityDefinition,
  SurgeWindow,
} from '../../domain/surge/types';
import type { ComebackTier } from '../../domain/comeback/types';
import type {
  DailyAdventurePresentation,
  DailyAdventurePresentationKind,
} from '../../domain/adventure/presentation.v1';

/**
 * <TodaysAdventure /> — V1 "Today's Adventure" surface.
 *
 * The single home of the highest-priority engagement opportunities.
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │  Today's Adventure                                                   │
 *   │                                                                     │
 *   │  Precedence (top wins, exactly one primary slot):                    │
 *   │    1. surge              — active Surge with eligible tasks         │
 *   │    2. mystery_ready      — a fully unlocked Mystery Drop            │
 *   │    3. comeback           — an active Comeback Mission               │
 *   │    4. mystery_available  — a still-progressing Mystery Drop         │
 *   │    5. seasonal           — seasonal accent when nothing outranks    │
 *   │    6. normal             — calm fallback (3 quests / all caught up) │
 *   │                                                                     │
 *   │  Loading: when the host has not yet resolved authoritative state,   │
 *   │  we render an explicit loading state. We NEVER flash a special      │
 *   │  opportunity and then withdraw it.                                  │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * Precedence lives in the pure resolver `resolveDailyAdventurePresentation`.
 * This component only renders the resolved kind. It NEVER inspects the
 * inputs to decide what to show — that would re-introduce the precedence
 * drift the resolver exists to prevent.
 *
 * Mystery READY outranks Comeback. Mystery LOCKED / progress loses to
 * Comeback. The resolver pins both rules.
 */

export type MysteryDropDisplay = {
  readonly id: string;
  readonly rarity: 'common' | 'rare' | 'epic';
  readonly messageKey: string;
  /** True when the drop is fully unlocked (OPEN button shown). */
  readonly isRevealReady: boolean;
  /** Optional progress label "0/1" for locked / progress UI. */
  readonly progressLabel?: string;
};

export type TodaysAdventureProps = {
  /** Optional Surge. The highest-precedence card when present. */
  readonly surge?: {
    readonly surgeId: string;
    readonly surge: SurgeEligibilityDefinition;
    readonly window: SurgeWindow;
    readonly eligibleTasks: readonly TaskSummary[];
  } | null;
  /** Urgency badge ("ending" / "soon" / "normal") — surfaces above the surge. */
  readonly urgency?: 'ending' | 'soon' | 'normal';
  /** Optional Comeback Mission. Rendered below the surge when present. */
  readonly comeback?: {
    readonly tier: ComebackTier;
    readonly inactivityDays: number;
    readonly missionCompleted: boolean;
  } | null;
  /** Mystery Drop display (presence-only; reveal handled separately). */
  readonly mysteryDrop?: MysteryDropDisplay | null;
  /** Tap handler — fires with the surge task id when the child picks one. */
  readonly onSelectSurgeTask: (taskId: string) => void;
  /** Tap handler — fires with the drop id when the child taps the banner. */
  readonly onPressMysteryDrop?: (dropId: string) => void;
  /** Tap handler — fires when the comeback card is tapped. */
  readonly onPressComeback?: () => void;
  /** Tap handler — fires when the calm fallback CTA is tapped. */
  readonly onViewQuests?: () => void;
  /** Resolved presentation kind. Single field the UI multiplexes on. */
  readonly presentation: DailyAdventurePresentation;
  /** Optional count of quests waiting (for normal state). */
  readonly normalQuestCount?: number;
  /** Whether all quests have been completed (overrides quest count). */
  readonly allCaughtUp?: boolean;
  /** Optional layout class. */
  readonly className?: string;
};

/**
 * Render the V1 Today's Adventure surface. Pure presentation.
 *
 * The component is intentionally tolerant: missing data is rendered as
 * absence rather than crash.
 */
export function TodaysAdventure({
  surge,
  urgency = 'normal',
  comeback,
  mysteryDrop,
  onSelectSurgeTask,
  onPressMysteryDrop,
  onPressComeback,
  onViewQuests,
  presentation,
  normalQuestCount,
  allCaughtUp,
  className,
}: TodaysAdventureProps) {
  const { t } = useTranslation('home');

  const kind: DailyAdventurePresentationKind = presentation.kind;
  const heading = t('child.adventure.heading');

  return (
    <section
      aria-label={heading}
      data-testid="todays-adventure"
      data-adventure-kind={kind}
      className={cn('space-y-3', className)}
    >
      <header className="flex items-center gap-2 px-1">
        <Sparkles size={16} aria-hidden="true" className="text-xp-500" />
        <h2 className="text-card-title qk-text-primary">{heading}</h2>
        {urgency === 'ending' && surge && (
          <span
            data-testid="todays-adventure-urgency"
            className="ml-auto rounded-full bg-coral-50 px-2.5 py-0.5 text-meta font-bold uppercase tracking-wide text-coral-700"
          >
            {t('child.adventure.endingSoon')}
          </span>
        )}
      </header>

      {kind === 'loading' && <TodaysAdventureLoading />}

      {kind === 'surge' && surge && (
        <SurgeBanner
          surgeId={surge.surgeId}
          surge={surge.surge}
          endsAt={surge.window.endsAt}
          eligibleTasks={surge.eligibleTasks}
          onSelectTask={onSelectSurgeTask}
        />
      )}

      {kind === 'mystery_ready' && mysteryDrop && (
        <MysteryReadyCard
          drop={mysteryDrop}
          onOpen={() => onPressMysteryDrop?.(mysteryDrop.id)}
        />
      )}

      {kind === 'comeback' && comeback && (
        <ComebackMissionCard
          tier={comeback.tier}
          inactivityDays={comeback.inactivityDays}
          missionCompleted={comeback.missionCompleted}
          onPress={onPressComeback}
        />
      )}

      {kind === 'mystery_available' && mysteryDrop && (
        <MysteryLockedCard drop={mysteryDrop} />
      )}

      {kind === 'seasonal' && <SeasonalAccent />}

      {kind === 'normal' && (
        <NormalAdventureCard
          questCount={normalQuestCount ?? 0}
          allCaughtUp={allCaughtUp === true}
          onViewQuests={onViewQuests}
        />
      )}
    </section>
  );
}

/**
 * Calm loading state. Pinned via tests so we never accidentally flash
 * a special opportunity while authoritative state is unresolved.
 */
function TodaysAdventureLoading() {
  const { t } = useTranslation('home');
  return (
    <div
      role="status"
      data-testid="todays-adventure-loading"
      aria-live="polite"
      className="flex items-center gap-3 rounded-2xl border border-transparent qk-bg-card px-4 py-3"
    >
      <span
        aria-hidden="true"
        className="h-3 w-3 animate-pulse rounded-full bg-xp-200"
      />
      <p className="text-meta qk-text-secondary">{t('child.adventure.loading')}</p>
    </div>
  );
}

/**
 * Mystery READY card — outranks Comeback. Calm full-width button, clearly
 * labelled "Open".
 */
function MysteryReadyCard({
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
      onClick={onOpen}
      data-testid="todays-adventure-mystery-ready"
      data-mystery-rarity={drop.rarity}
      data-mystery-state="ready"
      className="flex w-full items-center gap-3 rounded-2xl border border-xp-300 bg-xp-100 px-4 py-3 text-left shadow-sm hover:bg-xp-200 active:bg-xp-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-xp-600"
      aria-label={t('child.adventure.mystery.readyAria')}
    >
      <span
        aria-hidden="true"
        className="flex h-10 w-10 items-center justify-center rounded-xl bg-xp-500 text-white shadow"
      >
        <Gift size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-card-title text-xp-700">
          {t('child.adventure.mystery.readyTitle')}
        </p>
        <p className="mt-0.5 text-meta text-xp-600">
          {drop.messageKey ? t(drop.messageKey) : ''}
        </p>
      </div>
      <span
        aria-hidden="true"
        className="rounded-full bg-xp-500 px-3 py-1 text-meta font-bold uppercase tracking-wide text-white shadow"
      >
        {t('child.adventure.mystery.readyAction')}
      </span>
    </button>
  );
}

/**
 * Mystery LOCKED / progress card — outranked by Comeback. Calm progress
 * presentation; no loud "open" affordance.
 */
function MysteryLockedCard({ drop }: { drop: MysteryDropDisplay }) {
  const { t } = useTranslation('home');
  return (
    <div
      data-testid="todays-adventure-mystery-locked"
      data-mystery-rarity={drop.rarity}
      data-mystery-state="locked"
      className="flex items-center gap-3 rounded-2xl border border-xp-200 bg-xp-50 px-4 py-3"
      role="group"
      aria-label={t('child.adventure.mystery.lockedTitle')}
    >
      <span
        aria-hidden="true"
        className="flex h-10 w-10 items-center justify-center rounded-xl bg-xp-200 text-xp-700"
      >
        <Sparkles size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-card-title text-xp-700">
          {t('child.adventure.mystery.lockedTitle')}
        </p>
        <p className="mt-0.5 text-meta text-xp-600">
          {t('child.adventure.mystery.lockedLead')}
        </p>
      </div>
      <span
        aria-hidden="true"
        className="rounded-full bg-xp-100 px-2.5 py-0.5 text-meta font-bold tabular-nums text-xp-700"
      >
        {drop.progressLabel ?? '0 / 1'}
      </span>
    </div>
  );
}

/**
 * Seasonal-only accent. Subtle, never replaces the primary card. Only
 * surfaces when no other opportunity outranks it.
 */
function SeasonalAccent() {
  const { t } = useTranslation('home');
  return (
    <div
      data-testid="todays-adventure-seasonal"
      className="flex items-center gap-3 rounded-2xl qk-bg-card qk-border-subtle border px-4 py-3 qk-shadow-card"
    >
      <span
        aria-hidden="true"
        className="flex h-10 w-10 items-center justify-center rounded-xl bg-family-50 text-family-600"
      >
        <PartyPopper size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-card-title qk-text-primary">
          {t('child.adventure.seasonal.title')}
        </p>
        <p className="mt-0.5 text-meta qk-text-secondary">
          {t('child.adventure.seasonal.description')}
        </p>
      </div>
    </div>
  );
}

/**
 * Normal-state calm fallback. Visibly quieter than Surge / Mystery /
 * Comeback. Always reachable on a resolved state with no special
 * opportunity. Never manufactures a reward or event.
 */
function NormalAdventureCard({
  questCount,
  allCaughtUp,
  onViewQuests,
}: {
  questCount: number;
  allCaughtUp: boolean;
  onViewQuests?: () => void;
}) {
  const { t } = useTranslation('home');
  return (
    <TactileCard
      onClick={onViewQuests}
      data-testid="todays-adventure-normal"
      data-normal-state={allCaughtUp ? 'all-caught-up' : 'quests-waiting'}
      className="flex items-center gap-4 p-4"
    >
      <span
        aria-hidden="true"
        className="flex h-11 w-11 items-center justify-center rounded-xl qk-bg-inset qk-text-secondary"
      >
        <ListChecks size={22} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-card-title qk-text-primary">
          {allCaughtUp
            ? t('child.normal.allCaughtUp')
            : t('child.normal.questCount', { count: questCount })}
        </p>
        <p className="mt-0.5 text-meta qk-text-secondary">
          {allCaughtUp
            ? t('child.normal.allCaughtUpBody')
            : t('child.normal.body')}
        </p>
      </div>
      {onViewQuests && (
        <TactileButton size="sm" variant="ghost" onClick={onViewQuests}>
          {t('child.normal.viewQuests')}
        </TactileButton>
      )}
    </TactileCard>
  );
}

export default TodaysAdventure;