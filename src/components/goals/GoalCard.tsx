import { Card, CardContent } from '../ui/Card';
import { Progress } from '../ui/Progress';
import { Badge } from '../ui/Badge';
import { CurrencyDisplay } from '../ui/CurrencyDisplay';
import { useStore } from '../../store/useStore';
import { normalizeGoalDoc, type Goal, type GoalStatus } from '../../lib/goalContracts';
import { Target, User, Users, Trash2 } from 'lucide-react';

const STATUS_LABEL: Record<GoalStatus, string> = {
  active: 'Active',
  reached: 'Reached 🎉',
  completed_purchased: 'Purchased',
  completed_returned: 'Returned',
  cancelled: 'Cancelled',
};

const STATUS_VARIANT: Record<GoalStatus, 'primary' | 'success' | 'warning' | 'danger' | 'default'> = {
  active: 'primary',
  reached: 'success',
  completed_purchased: 'success',
  completed_returned: 'warning',
  cancelled: 'danger',
};

export function GoalCard({ goal, onClick, onDelete }: { goal: any; onClick?: () => void; onDelete?: () => void }) {
  const { familyMembers } = useStore();
  const g: Goal = normalizeGoalDoc(goal);
  const pct = g.targetAmountPence > 0 ? Math.min(100, (g.currentAmountPence / g.targetAmountPence) * 100) : 0;
  const child = g.kind === 'child' && g.childId
    ? familyMembers.find(m => m.id === g.childId)
    : undefined;

  const isCancelled = g.status === 'cancelled';

  // Stop the delete click from also opening the goal detail.
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.();
  };

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-2xl">{g.kind === 'family' ? '👨‍👩‍👧‍👦' : '🎯'}</span>
            <div className="min-w-0">
              <h3 className="font-bold text-gray-900 truncate">{g.title}</h3>
              <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                {g.kind === 'family' ? <Users size={12} /> : <User size={12} />}
                {g.kind === 'family' ? 'Family goal' : child?.displayName ?? 'Child goal'}
              </p>
            </div>
          </div>
          <Badge variant={STATUS_VARIANT[g.status]}>{STATUS_LABEL[g.status]}</Badge>
          {isCancelled && onDelete && (
            <button
              type="button"
              aria-label="Delete cancelled goal"
              title="Delete cancelled goal"
              onClick={handleDelete}
              className="p-1.5 rounded-lg text-gray-400 hover:text-danger-600 hover:bg-danger-50 transition-colors"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>

        <div className="flex items-end justify-between mb-2">
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase">Saved</p>
            <p className="text-xl font-extrabold text-gray-900">
              <CurrencyDisplay amountPence={g.currentAmountPence} forceColor={false} />
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500 font-medium uppercase">Target</p>
            <p className="font-bold text-gray-700">
              <CurrencyDisplay amountPence={g.targetAmountPence} forceColor={false} />
            </p>
          </div>
        </div>

        <Progress value={pct} max={100} color={g.status === 'reached' ? 'success' : 'primary'} />

        {g.matching && g.matching.mode !== 'none' && (
          <p className="text-[11px] text-primary-600 font-medium mt-2 flex items-center gap-1">
            <Target size={12} /> Matching {g.matching.mode === 'auto' ? 'auto' : 'available'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
