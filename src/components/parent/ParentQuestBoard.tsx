import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Send, CheckCircle2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useStore } from '../../store/useStore';
import { useRecurrenceClock } from '../../lib/useRecurrenceClock';
import { selectQuestBoard } from '../../lib/quests/board';
import { CharacterFrame } from '../queki/CharacterFrame';
import { TactileCard } from '../queki/TactileCard';
import { TactileButton } from '../queki/TactileButton';
import { QuekiMascot } from '../queki/QuekiMascot';
import { StatusBadge } from '../queki/StatusBadge';

/**
 * ParentQuestBoard — Queki v2 parent quest surface (Wave 2, Phase 14).
 *
 * NOT the child RPG board: a calm management overview. Single-child families
 * get no redundant child filter; multi-child families get natural member
 * chips. Management (edit/archive) stays behind a tap → detail modal, so no
 * edit/delete controls are permanently exposed.
 */
export function ParentQuestBoard({
  onOpenTask,
  onCreate,
}: {
  onOpenTask: (task: any) => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation('quests');
  const { tasks, taskCompletions, familyMembers, bootstrapStatus } = useStore();
  const now = useRecurrenceClock();
  const [childFilter, setChildFilter] = useState<string | null>(null);

  const children = useMemo(() => familyMembers.filter(m => m?.role === 'child'), [familyMembers]);
  const isSingleChild = children.length === 1;

  const loading =
    !bootstrapStatus ||
    (['tasks', 'members'] as const).some(
      resource =>
        bootstrapStatus[resource] === 'loading' || bootstrapStatus[resource] === 'idle',
    );

  // Parent context: no child scoping — every quest is visible; per-child
  // completion state is derived against the task's assignee.
  const board = useMemo(
    () => selectQuestBoard(tasks, taskCompletions, now),
    [tasks, taskCompletions, now],
  );

  const visible = useMemo(() => {
    const views = [...board.active, ...board.pending, ...board.done];
    if (!childFilter) return views;
    return views.filter(
      v => !v.task.assigneeId || v.task.assigneeId === childFilter,
    );
  }, [board, childFilter]);

  const memberName = (id?: string | null) =>
    familyMembers.find(m => m?.id === id)?.displayName;

  if (loading) {
    return (
      <div className="space-y-3 pb-8" data-testid="parent-quest-board-loading" aria-busy="true">
        <div className="h-20 animate-pulse rounded-card qk-bg-inset" aria-hidden="true" />
        <div className="h-20 animate-pulse rounded-card qk-bg-inset" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-8" data-testid="parent-quest-board">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-title qk-text-primary">{t('parentBoard.title')}</h1>
          <p className="text-meta qk-text-secondary">
            {t('parentBoard.subtitle', { count: board.active.length })}
          </p>
        </div>
        <TactileButton size="sm" onClick={onCreate} aria-label={t('parentBoard.createFirst')}>
          <Plus size={16} aria-hidden="true" />
          {t('parentBoard.createFirst')}
        </TactileButton>
      </header>

      {/* Multi-child filter chips — hidden for single-child families. */}
      {!isSingleChild && children.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={t('parentBoard.filterAll')}>
          <button
            type="button"
            role="tab"
            aria-selected={childFilter === null}
            onClick={() => setChildFilter(null)}
            className={cn(
              'shrink-0 rounded-full px-4 py-2 text-body font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
              childFilter === null ? 'bg-primary-500 text-white' : 'qk-bg-raised qk-text-secondary border qk-border-subtle',
            )}
          >
            {t('parentBoard.filterAll')}
          </button>
          {children.map(child => (
            <button
              key={child.id}
              type="button"
              role="tab"
              aria-selected={childFilter === child.id}
              onClick={() => setChildFilter(child.id)}
              className={cn(
                'inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-body font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                childFilter === child.id ? 'bg-primary-500 text-white' : 'qk-bg-raised qk-text-secondary border qk-border-subtle',
              )}
            >
              <CharacterFrame src={child.avatarUrl} fallback={child.displayName} size={24} />
              {child.displayName}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <div
          className="flex flex-col items-center gap-3 rounded-card qk-bg-card qk-border-subtle qk-shadow-card border p-8 text-center"
          data-testid="parent-quest-board-empty"
        >
          <QuekiMascot state="encouraging" size={104} />
          <p className="text-card-title qk-text-primary">{t('parentBoard.emptyTitle')}</p>
          <p className="max-w-xs text-body qk-text-secondary">{t('parentBoard.emptyDescription')}</p>
          <TactileButton onClick={onCreate}>{t('parentBoard.createFirst')}</TactileButton>
        </div>
      ) : (
        <>
          <p className="text-meta qk-text-secondary">{t('parentBoard.manageHint')}</p>
          <div className="space-y-3">
            {visible.map(view => {
              const pending = view.state === 'pending';
              const approved = view.state === 'approved';
              return (
                <TactileCard
                  key={`${view.task.id}-${view.completionId ?? 'active'}`}
                  onPress={() => onOpenTask({ ...view.task, status: view.state, completionId: view.completionId })}
                  className={cn('flex items-center gap-3 p-4', approved && 'opacity-70')}
                  tone={pending ? 'streak' : undefined}
                  data-testid="parent-quest-row"
                >
                  <CharacterFrame
                    src={familyMembers.find(m => m?.id === view.task.assigneeId)?.avatarUrl}
                    fallback={memberName(view.task.assigneeId) ?? '★'}
                    size={40}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-card-title qk-text-primary">{view.task.title}</p>
                    <p className="text-meta qk-text-secondary">
                      {view.task.assigneeId
                        ? t('parentBoard.assignedTo', { name: memberName(view.task.assigneeId) })
                        : t('parentBoard.sharedBadge')}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-xp-50 px-2.5 py-1 text-meta font-bold text-xp-700 dark:bg-xp-100 dark:text-xp-300">
                    +{view.task.pointsReward ?? 0}
                  </span>
                  {pending && (
                    <StatusBadge tone="streak">
                      <Send size={11} className="mr-1 inline" aria-hidden="true" />
                      {t('parentBoard.pendingBadge')}
                    </StatusBadge>
                  )}
                  {approved && (
                    <StatusBadge tone="mint">
                      <CheckCircle2 size={11} className="mr-1 inline" aria-hidden="true" />
                      {t('parentBoard.approvedBadge')}
                    </StatusBadge>
                  )}
                </TactileCard>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
