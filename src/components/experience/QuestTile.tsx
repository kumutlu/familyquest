/**
 * <QuestTile /> — productized, actionable quest row for the Child Home.
 *
 * Architectural rules
 *   - Read-only. Tapping a row navigates to /tasks where the existing
 *     hold-to-complete flow owns the authoritative completion path. We
 *     never introduce a parallel completion here.
 *   - The row carries only canonical task data — id, title, pointsReward,
 *     isCompletedToday — sourced from the existing `tasks` /
 *     `taskCompletions` collections.
 *   - The list is capped by the host (typically 3 items) so the home
 *     surface never grows unbounded.
 *   - We DO NOT introduce a category icon (no decoration that pretends to
 *     know the task's true category beyond what the engine surfaces).
 *
 * Visual rules
 *   - Compact 56px tile rather than a tall database row.
 *   - Reward chip is the XP points total (a single number, never
 *     fabricated). When completed, the chip flips to mint and shows a
 *     check.
 *   - Reduced motion: the hover translate collapses via tokens.
 */

import { Check, Star } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface QuestTileProps {
  readonly id: string;
  readonly title: string;
  readonly pointsReward: number;
  readonly isCompletedToday?: boolean;
  readonly onPress: (taskId: string) => void;
}

export function QuestTile({
  id,
  title,
  pointsReward,
  isCompletedToday,
  onPress,
}: QuestTileProps) {
  const completed = isCompletedToday === true;
  const safePoints = Math.max(0, Math.floor(
    Number.isFinite(pointsReward) ? pointsReward : 0,
  ));
  return (
    <button
      type="button"
      data-testid={`quest-tile-${id}`}
      data-quest-completed={completed ? '1' : '0'}
      onClick={() => onPress(id)}
      aria-label={
        completed
          ? `${title}, ${safePoints} points, completed`
          : `${title}, ${safePoints} points, open to start`
      }
      className={cn(
        'qk-quest-tile',
        completed && 'opacity-90',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
          completed ? 'bg-mint-50 text-mint-600' : 'bg-xp-50 text-xp-600',
        )}
      >
        {completed ? <Check size={16} aria-hidden="true" /> : <Star size={16} aria-hidden="true" className="fill-current" />}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate text-card-title font-semibold qk-text-primary',
            completed && 'line-through decoration-mint-300',
          )}
        >
          {title}
        </p>
      </div>
      <span
        className={cn('qk-quest-tile__reward', completed && 'qk-quest-tile__reward--done')}
      >
        {safePoints}
        <span aria-hidden="true" className="text-[0.7em] uppercase tracking-wide">
          pts
        </span>
      </span>
    </button>
  );
}

export interface QuestTileListProps {
  readonly quests: readonly QuestTileProps[];
  readonly onPressQuest: (taskId: string) => void;
  readonly onViewAll?: () => void;
}

export function QuestTileList({ quests, onPressQuest, onViewAll }: QuestTileListProps) {
  const items = Array.isArray(quests) ? quests.slice(0, 3) : [];
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      {items.map(q => (
        <QuestTile key={q.id} {...q} onPress={onPressQuest} />
      ))}
      {onViewAll ? (
        <div className="flex justify-end pt-1">
          <button
            type="button"
            data-testid="quest-tile-view-all"
            onClick={onViewAll}
            className="text-meta font-bold uppercase tracking-wide text-family-600 hover:text-family-700 focus:outline-none focus-visible:underline"
          >
            See all quests →
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default QuestTileList;