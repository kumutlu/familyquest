import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flame } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { completeTask } from '../../lib/api';
import { useRecurrenceClock } from '../../lib/useRecurrenceClock';
import {
  computeTodayProgress,
  selectQuestBoard,
  type QuestView,
} from '../../lib/quests/board';
import {
  createCompletionMachine,
  type CompletionMachineModel,
} from '../../lib/quests/completionMachine';

/** A chainable machine instance as produced by createCompletionMachine(). */
type CompletionMachine = CompletionMachineModel & {
  reduce: (event: import('../../lib/quests/completionMachine').CompletionEvent) => CompletionMachine;
};
import { ProgressBar } from '../queki/Progress';
import { QuekiMascot } from '../queki/QuekiMascot';
import { TactileButton } from '../queki/TactileButton';
import { triggerHaptic } from '../../lib/interaction/haptics';
import { playCue } from '../../lib/interaction/sound';
import {
  CompactQuestCard,
  DoneQuestStrip,
  FeaturedQuestCard,
  PendingQuestCard,
} from './QuestCards';
import { ApprovedRewardMoment, CompletionMoment } from './CompletionMoments';

/**
 * QuestBoard — the Queki v2 child quest surface (Wave 2).
 *
 * Replaces the legacy checklist for children at /tasks. All state shown is
 * derived from the AUTHORITATIVE store snapshots (`tasks`, `taskCompletions`)
 * through pure selectors — pending/completed states survive reloads because
 * they come from Firestore documents, never from component state. Component
 * state only tracks the in-flight interaction (via the completion state
 * machine) and transient celebration moments.
 */

interface InteractionState {
  taskId: string;
  machine: CompletionMachine;
}

interface MomentState {
  kind: 'submitted' | 'approved';
  questTitle: string;
  points: number;
  reviewerName?: string;
  autoApproved?: boolean;
}

export function QuestBoard() {
  const { t } = useTranslation('quests');
  const { currentUser, tasks, taskCompletions, bootstrapStatus } = useStore();
  const now = useRecurrenceClock();

  const [expanded, setExpanded] = useState(false);
  const [interaction, setInteraction] = useState<InteractionState | null>(null);
  const [moment, setMoment] = useState<MomentState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isChild = currentUser?.role === 'child';

  // ---------------------------------------------------------------------
  // Structured loading: never flash an empty board / 0-of-0 while the
  // authoritative snapshots are still hydrating.
  // ---------------------------------------------------------------------
  const loading =
    !bootstrapStatus ||
    (['tasks', 'members'] as const).some(
      resource =>
        bootstrapStatus[resource] === 'loading' || bootstrapStatus[resource] === 'idle',
    );

  const board = useMemo(
    () => selectQuestBoard(tasks, taskCompletions, now, isChild ? currentUser?.id : undefined),
    [tasks, taskCompletions, now, isChild, currentUser?.id],
  );

  const progress = useMemo(
    () => computeTodayProgress(tasks, taskCompletions, now, isChild ? currentUser?.id : undefined),
    [tasks, taskCompletions, now, isChild, currentUser?.id],
  );

  const streakDays = Number(currentUser?.currentStreak ?? 0);

  // ---------------------------------------------------------------------
  // Approved-moment detection: fires ONCE per pending → approved transition
  // observed in the authoritative snapshot (including approvals that arrive
  // while the child is on another tab — the listener updates the snapshot).
  // ---------------------------------------------------------------------
  const previousStatusesRef = useRef<Map<string, string>>(new Map());
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!isChild || loading) return;
    const next = new Map<string, string>();
    let approvedTransition: QuestView | null = null;
    for (const view of [...board.pending, ...board.done]) {
      const key = String(view.completionId ?? view.task.id);
      const status = view.state === 'approved' ? 'approved' : 'pending_approval';
      const prev = previousStatusesRef.current.get(key);
      if (status === 'approved' && prev === 'pending_approval') {
        approvedTransition = view;
      }
      next.set(key, status);
    }
    previousStatusesRef.current = next;
    if (approvedTransition) {
      triggerHaptic('celebrate');
      playCue('approve');
      setMoment({
        kind: 'approved',
        questTitle: String(approvedTransition.task.title ?? ''),
        points: Number(approvedTransition.task.pointsReward ?? 0),
      });
    }
    forceRender(n => n + 1);
  }, [board.pending, board.done, isChild, loading]);

  // ---------------------------------------------------------------------
  // Completion mutation — exactly-once via the state machine; the backend
  // transaction adds its own deterministic-id idempotency underneath.
  // ---------------------------------------------------------------------
  const handleComplete = useCallback(
    async (quest: QuestView) => {
      if (!currentUser?.familyId || !currentUser?.id) return;
      if (interaction?.taskId === quest.task.id && interaction.machine.state === 'submitting') {
        return; // double-fire guard (hold race, rerender, listener blip)
      }
      setError(null);
      let machine = createCompletionMachine({ authoritativeStatus: null }).reduce({
        type: 'COMPLETE_NOW',
      });
      setInteraction({ taskId: quest.task.id, machine });

      try {
        await completeTask(
          currentUser.familyId,
          quest.task.id,
          currentUser.id,
          quest.task.requiresApproval !== false,
          now,
        );
        const requiresApproval = quest.task.requiresApproval !== false;
        machine = machine.reduce({
          type: 'SUBMIT_RESOLVED',
          outcome: requiresApproval ? 'pending' : 'approved',
        });
        setInteraction({ taskId: quest.task.id, machine });
        triggerHaptic('submit');
        playCue('submit');
        setMoment({
          kind: 'submitted',
          questTitle: String(quest.task.title ?? ''),
          points: Number(quest.task.pointsReward ?? 0),
          autoApproved: !requiresApproval,
        });
      } catch (err) {
        machine = machine.reduce({
          type: 'SUBMIT_FAILED',
          message: err instanceof Error ? err.message : t('review.errorRetry'),
        });
        setInteraction({ taskId: quest.task.id, machine });
        setError(err instanceof Error ? err.message : t('review.errorRetry'));
      }
    },
    [currentUser, interaction, now, t],
  );

  // Authoritative reconciliation: if a listener delivers the pending record
  // while we're mid-flight (or after), adopt it — never downgrade submitting.
  useEffect(() => {
    if (!interaction) return;
    const view =
      board.pending.find(v => v.task.id === interaction.taskId) ??
      board.done.find(v => v.task.id === interaction.taskId);
    const status =
      view?.state === 'pending'
        ? 'pending_approval'
        : view?.state === 'approved'
          ? 'approved'
          : null;
    const synced = interaction.machine.reduce({ type: 'SYNC', status });
    if (synced !== interaction.machine) {
      setInteraction({ taskId: interaction.taskId, machine: synced });
    }
  }, [board.pending, board.done, interaction]);

  const submittingId = interaction?.machine.state === 'submitting' ? interaction.taskId : null;

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  if (loading) {
    return (
      <div className="space-y-4 pb-8" data-testid="quest-board-loading" aria-busy="true">
        <div className="h-40 animate-pulse rounded-hero qk-bg-inset" aria-hidden="true" />
        <div className="h-28 animate-pulse rounded-card qk-bg-inset" aria-hidden="true" />
        <div className="h-20 animate-pulse rounded-card qk-bg-inset" aria-hidden="true" />
      </div>
    );
  }

  const actionableCount = progress.total;
  const everythingDone =
    actionableCount > 0 &&
    board.active.filter(v => v.state !== 'not_eligible_today').length === 0 &&
    board.pending.length === 0;

  return (
    <div className="space-y-6 pb-8" data-testid="quest-board">
      {/* ---- TODAY hero --------------------------------------------------- */}
      <section
        className="rounded-hero p-6 text-white"
        style={{
          background:
            'linear-gradient(135deg, var(--qk-surface-hero-from), var(--qk-surface-hero-to))',
        }}
        aria-label={t('board.todayLabel')}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-meta font-bold uppercase tracking-widest opacity-75">
              {t('board.todayLabel')}
            </p>
            <p className="mt-1 font-balance text-display tabular-nums" data-testid="today-progress">
              {t('board.progressConfirmed', { confirmed: progress.confirmed, total: progress.total })}
            </p>
          </div>
          <span
            className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5"
            aria-label={t('board.streakAria', { days: streakDays })}
          >
            <Flame
              size={16}
              className={streakDays > 0 ? 'fill-streak-300 text-streak-300' : 'text-white/60'}
              aria-hidden="true"
            />
            <span className="font-balance tabular-nums">{streakDays}</span>
          </span>
        </div>

        <ProgressBar
          className="mt-4 bg-white/20"
          tone="xp"
          value={progress.total > 0 ? (progress.confirmed / progress.total) * 100 : 0}
          aria-label={t('board.progressAria', {
            confirmed: progress.confirmed,
            total: progress.total,
          })}
        />

        {/* Submitted-but-unconfirmed is shown HONESTLY, separate from the ratio. */}
        {progress.submitted > 0 && (
          <p
            className="mt-2 inline-flex rounded-full bg-streak-500/80 px-3 py-1 text-meta font-semibold"
            role="status"
            data-testid="submitted-chip"
          >
            {t('board.submittedChip', { count: progress.submitted })}
          </p>
        )}
      </section>

      {/* ---- Error banner -------------------------------------------------- */}
      {error && (
        <div role="alert" className="flex items-center gap-3 rounded-card bg-coral-50 p-4 text-coral-700">
          <div className="min-w-0 flex-1">
            <p className="text-body font-semibold">{error}</p>
            <p className="text-meta">{t('review.errorRetry')}</p>
          </div>
          <TactileButton size="sm" variant="coral" onClick={() => setError(null)}>
            OK
          </TactileButton>
        </div>
      )}

      {/* ---- Active quests -------------------------------------------------- */}
      {everythingDone ? (
        <EmptyPanel
          testid="quest-board-all-done"
          mascotState="celebration"
          title={t('board.allDoneTitle')}
          description={t('board.allDoneDescription')}
        />
      ) : board.active.filter(v => v.state !== 'not_eligible_today').length === 0 &&
        board.pending.length === 0 ? (
        <EmptyPanel
          testid="quest-board-empty"
          mascotState="encouraging"
          title={t('board.emptyTitle')}
          description={t('board.emptyDescription')}
        />
      ) : (
        <>
          {board.featured && board.featured.state !== 'not_eligible_today' && (
            <FeaturedQuestCard
              quest={board.featured}
              onComplete={() => handleComplete(board.featured!)}
              submitting={submittingId === board.featured.task.id}
            />
          )}

          {(expanded ? board.active : board.initiallyVisible)
            .filter(v => v !== board.featured && v.state !== 'not_eligible_today')
            .map(view => (
              <CompactQuestCard
                key={view.task.id}
                quest={view}
                onComplete={() => handleComplete(view)}
                submitting={submittingId === view.task.id}
              />
            ))}

          {board.moreCount > 0 && !expanded && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              data-testid="quest-board-more"
              className="w-full rounded-xl py-3 text-body font-bold text-primary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              {t('board.moreQuests', { count: board.moreCount })} ↓
            </button>
          )}
        </>
      )}

      {/* ---- Pending (distinct from done) ---------------------------------- */}
      {board.pending.length > 0 && (
        <section className="space-y-3" aria-label={t('pendingCard.description')}>
          {board.pending.map(view => (
            <PendingQuestCard key={view.completionId ?? view.task.id} quest={view} />
          ))}
        </section>
      )}

      {/* ---- Done today (compact, non-dominant) ----------------------------- */}
      {board.done.length > 0 && (
        <section className="space-y-2" aria-label={t('board.doneSectionTitle')}>
          <h2 className="text-meta font-bold uppercase tracking-wide qk-text-secondary">
            {t('board.doneSectionTitle')}
          </h2>
          {board.done.map(view => (
            <DoneQuestStrip key={view.completionId ?? view.task.id} quest={view} />
          ))}
        </section>
      )}

      {/* ---- Moments --------------------------------------------------------- */}
      {moment?.kind === 'submitted' && (
        <CompletionMoment
          questTitle={moment.questTitle}
          points={moment.points}
          reviewerName={moment.reviewerName}
          autoApproved={moment.autoApproved}
          onDone={() => setMoment(null)}
        />
      )}
      {moment?.kind === 'approved' && (
        <ApprovedRewardMoment
          xp={moment.points}
          points={moment.points}
          onDone={() => setMoment(null)}
        />
      )}
    </div>
  );
}

function EmptyPanel({
  testid,
  mascotState,
  title,
  description,
}: {
  testid: string;
  mascotState: 'encouraging' | 'celebration';
  title: string;
  description: string;
}) {
  return (
    <div
      data-testid={testid}
      className="flex flex-col items-center gap-3 rounded-card qk-bg-card qk-border-subtle qk-shadow-card border p-8 text-center"
    >
      <QuekiMascot state={mascotState} size={112} />
      <p className="text-title qk-text-primary">{title}</p>
      <p className="max-w-xs text-body qk-text-secondary">{description}</p>
    </div>
  );
}
