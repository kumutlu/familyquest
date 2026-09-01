import { useTranslation } from 'react-i18next';
import { Star, ChevronRight, Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { TactileButton } from './TactileButton';

/**
 * <QuestPreviewRow /> — V1 "Today's Quests" preview row.
 *
 * Architectural rules
 * -------------------
 *  - Read-only. The row NEVER claims a completion; tapping navigates to
 *    the Quests board, where the existing hold-to-complete flow owns
 *    the authoritative path.
 *  - The row surfaces only information already in `tasks`. We never
 *    pull gamification state from elsewhere to decide what to show
 *    here — that's the focus selector's job.
 *  - The list is capped by the host (typically 3 items) so the home
 *    surface never grows unbounded.
 *  - Empty list: we do NOT render a skeleton from this component. The
 *    parent owns loading/empty/error state for the whole section.
 */

export interface QuestPreviewItem {
  readonly id: string;
  readonly title: string;
  readonly pointsReward: number;
  /** When true, the quest has already been completed today. */
  readonly isCompletedToday?: boolean;
}

export type QuestPreviewRowProps = {
  readonly quest: QuestPreviewItem;
  /** Tap handler — navigates to the Quests board, pre-selecting the task. */
  readonly onPress: (taskId: string) => void;
  /** Optional layout class. */
  readonly className?: string;
};

/**
 * A single quest row. Pure presentation.
 */
export function QuestPreviewRow({
  quest,
  onPress,
  className,
}: QuestPreviewRowProps) {
  const { t } = useTranslation('home');
  const completed = quest.isCompletedToday === true;
  const safePoints = Math.max(0, Math.floor(
    Number.isFinite(quest.pointsReward) ? quest.pointsReward : 0,
  ));

  return (
    <button
      type="button"
      onClick={() => onPress(quest.id)}
      data-testid={`quest-preview-${quest.id}`}
      data-quest-completed={completed ? '1' : '0'}
      className={cn(
        'group flex w-full items-center gap-3 rounded-card px-4 py-3 text-left',
        'qk-bg-card qk-border-subtle qk-shadow-card border',
        'hover:translate-y-[-1px] hover:shadow-md active:translate-y-0',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-family-500',
        completed && 'opacity-70',
        className,
      )}
      aria-label={t('child.quests.preview.aria', {
        title: quest.title,
        points: safePoints,
        status: completed
          ? t('child.quests.preview.completed')
          : t('child.quests.preview.open'),
      })}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
          completed ? 'bg-mint-50 text-mint-600' : 'bg-xp-50 text-xp-600',
        )}
      >
        {completed ? <Check size={18} aria-hidden="true" /> : (
          <Star size={18} aria-hidden="true" className="fill-current" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate text-card-title qk-text-primary',
            completed && 'line-through decoration-xp-300',
          )}
        >
          {quest.title}
        </p>
        <p className="mt-0.5 text-meta qk-text-secondary">
          {t('child.quests.preview.points', { count: safePoints })}
        </p>
      </div>
      <span
        aria-hidden="true"
        className="qk-text-secondary opacity-0 transition-opacity group-hover:opacity-100"
      >
        <ChevronRight size={18} />
      </span>
    </button>
  );
}

/**
 * Container that renders up to N quest rows plus a "view all" CTA. The
 * list is rendered in a stable order (host-provided) — this component
 * never re-sorts quests.
 */
export type QuestPreviewListProps = {
  readonly quests: readonly QuestPreviewItem[];
  readonly onPressQuest: (taskId: string) => void;
  /** CTA handler — typically navigates to the full /tasks page. */
  readonly onViewAll?: () => void;
  readonly maxItems?: number;
  readonly className?: string;
};

export function QuestPreviewList({
  quests,
  onPressQuest,
  onViewAll,
  maxItems = 3,
  className,
}: QuestPreviewListProps) {
  const { t } = useTranslation('home');
  const items = (Array.isArray(quests) ? quests : []).slice(0, maxItems);
  if (items.length === 0) return null;

  return (
    <div className={cn('space-y-2', className)}>
      {items.map(q => (
        <QuestPreviewRow key={q.id} quest={q} onPress={onPressQuest} />
      ))}
      {onViewAll && quests.length > maxItems && (
        <div className="flex justify-end pt-1">
          <TactileButton variant="ghost" size="sm" onClick={onViewAll}>
            {t('child.quests.preview.viewAll')}
          </TactileButton>
        </div>
      )}
    </div>
  );
}

export default QuestPreviewList;