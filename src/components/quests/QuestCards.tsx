import { CheckCircle2, Clock3, Gift, RefreshCw, Send } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation } from 'react-i18next';
import type { QuestView } from '../../lib/quests/board';
import { HoldToCompleteButton } from './HoldToCompleteButton';

export interface QuestCardCallbacks {
  onComplete: (quest: QuestView) => void;
  /** True while this quest's completion mutation is in flight. */
  submittingId?: string | null;
}

/** Shared reward chip — warm gold identity for POINTS (reward currency, never coral/error). */
function PointsChip({ points, className }: { points: number; className?: string }) {
  const { t } = useTranslation('quests');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-xp-50 px-2.5 py-1 text-meta font-bold text-xp-700 dark:bg-xp-100 dark:text-xp-300',
        className,
      )}
      aria-label={t('quest.pointsAria', { points })}
    >
      <Gift size={13} aria-hidden="true" />
      +{points}
    </span>
  );
}

/** Deterministic friendly icon per quest schedule type (no metadata dump). */
function QuestGlyph({ quest, size = 22 }: { quest: QuestView; size?: number }) {
  const type = quest.task.type ?? '';
  const glyph =
    type === 'weekly' ? (
      <CalendarGlyph />
    ) : type === 'one-time' || type === 'custom' ? (
      <StarGlyph />
    ) : (
      <SunGlyph />
    );
  return (
    <span
      aria-hidden="true"
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-50 text-primary-500 [&_svg]:h-6 [&_svg]:w-6"
      style={{ width: size * 2, height: size * 2 }}
    >
      {glyph}
    </span>
  );
}

function SunGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function CalendarGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function StarGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Featured Quest Card
// ---------------------------------------------------------------------------

export function FeaturedQuestCard({
  quest,
  onComplete,
  submitting,
}: {
  quest: QuestView;
  onComplete: () => void;
  submitting: boolean;
}) {
  const { t } = useTranslation('quests');
  const isRetry = quest.state === 'retry';

  return (
    <section
      aria-label={String(quest.task.title ?? '')}
      data-testid="featured-quest"
      className="rounded-card qk-bg-card qk-border-subtle qk-shadow-card border p-5"
      style={{
        animation: 'qk-card-in var(--animate-duration-enter) var(--ease-enter) both',
      }}
    >
      {isRetry && (
        <div
          className="mb-4 flex items-start gap-2 rounded-xl bg-streak-50 p-3 text-streak-700"
          role="note"
        >
          <RefreshCw size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-body font-bold">{t('quest.retryTitle')}</p>
            {quest.parentComment && (
              <p className="mt-0.5 break-words text-meta" aria-label={t('quest.parentCommentAria')}>
                “{quest.parentComment}”
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-4">
        <QuestGlyph quest={quest} size={24} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-title qk-text-primary">{quest.task.title}</h2>
          <div className="mt-1.5 flex items-center gap-2">
            <PointsChip points={Number(quest.task.pointsReward ?? 0)} />
            {isRetry && (
              <span className="inline-flex items-center gap-1 rounded-full bg-streak-50 px-2.5 py-1 text-meta font-bold text-streak-600">
                <RefreshCw size={12} aria-hidden="true" />
                {t('quest.retryAction')}
              </span>
            )}
          </div>
        </div>
      </div>

      <HoldToCompleteButton
        className="mt-5"
        label={isRetry ? `${t('quest.retryAction')}: ${quest.task.title}` : `${t('quest.holdToComplete')}: ${quest.task.title}`}
        onComplete={onComplete}
        disabled={submitting}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Compact Quest Card
// ---------------------------------------------------------------------------

export function CompactQuestCard({
  quest,
  onComplete,
  submitting,
}: {
  quest: QuestView;
  onComplete: () => void;
  submitting: boolean;
}) {
  const { t } = useTranslation('quests');
  const isRetry = quest.state === 'retry';

  return (
    <div
      data-testid="compact-quest"
      className={cn(
        'rounded-card qk-bg-card qk-border-subtle qk-shadow-card border p-3',
        isRetry && 'border-l-4 border-l-streak-400',
      )}
    >
      <div className="flex items-center gap-3">
        <QuestGlyph quest={quest} size={16} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-card-title qk-text-primary">{quest.task.title}</p>
          {isRetry && quest.parentComment && (
            <p className="mt-0.5 truncate text-meta text-streak-600">“{quest.parentComment}”</p>
          )}
        </div>
        <PointsChip points={Number(quest.task.pointsReward ?? 0)} />
      </div>
      <HoldToCompleteButton
        className="mt-3 min-h-11"
        label={
          isRetry
            ? `${t('quest.retryAction')}: ${quest.task.title}`
            : `${t('quest.completeNow')}: ${quest.task.title}`
        }
        onComplete={onComplete}
        disabled={submitting}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pending Quest Card
// ---------------------------------------------------------------------------

export function PendingQuestCard({
  quest,
  reviewerName,
}: {
  quest: QuestView;
  reviewerName?: string;
}) {
  const { t } = useTranslation('quests');
  return (
    <div
      data-testid="pending-quest"
      role="status"
      className="flex items-center gap-3 rounded-card border border-streak-200 bg-streak-50 p-4"
    >
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-streak-500 text-white"
      >
        <Send size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-card-title font-extrabold text-streak-700">{t('pendingCard.title')}</p>
        <p className="text-meta text-streak-600">
          {reviewerName
            ? t('pendingCard.waitingFor', { name: reviewerName })
            : t('pendingCard.description')}
        </p>
      </div>
      <PointsChip points={Number(quest.task.pointsReward ?? 0)} className="bg-white/70" />
      <Clock3 size={16} className="shrink-0 text-streak-500" aria-hidden="true" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Done (approved) strip
// ---------------------------------------------------------------------------

export function DoneQuestStrip({ quest }: { quest: QuestView }) {
  const { t } = useTranslation('quests');
  return (
    <div
      data-testid="done-quest"
      role="status"
      aria-label={t('doneCard.aria', { title: quest.task.title })}
      className="flex items-center gap-3 rounded-xl bg-mint-50 px-4 py-2.5 opacity-90"
    >
      <CheckCircle2 size={18} className="shrink-0 text-mint-600" aria-hidden="true" />
      <p className="min-w-0 flex-1 truncate text-body font-semibold text-mint-700 line-through decoration-mint-400">
        {quest.task.title}
      </p>
      <span className="text-meta font-bold uppercase tracking-wide text-mint-600">
        {t('doneCard.title')}
      </span>
    </div>
  );
}
