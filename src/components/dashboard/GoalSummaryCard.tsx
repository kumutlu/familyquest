import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Progress } from '../ui/Progress';
import { CurrencyDisplay } from '../ui/CurrencyDisplay';
import { useStore } from '../../store/useStore';
import { normalizeGoalDoc } from '../../lib/goalContracts';
import { Target } from 'lucide-react';

/**
 * Compact goals summary for the Home dashboard.
 *
 * Reuses the existing bootstrap `savingsGoals` data (no new queries). Shows the
 * count of active goals, the total saved across them, and a small progress
 * indicator. The whole card links to /goals; individual goal rows remain
 * independently tappable and navigate to their detail at /goals/:goalId.
 */
export function GoalSummaryCard() {
  const navigate = useNavigate();
  const { savingsGoals } = useStore();

  const { activeGoals, totalSaved, overallPct } = useMemo(() => {
    const goals = (savingsGoals || []).map(normalizeGoalDoc).filter(g => g.status === 'active');
    const saved = goals.reduce((sum, g) => sum + g.currentAmountPence, 0);
    const target = goals.reduce((sum, g) => sum + g.targetAmountPence, 0);
    const pct = target > 0 ? Math.min(100, (saved / target) * 100) : 0;
    return { activeGoals: goals, totalSaved: saved, overallPct: pct };
  }, [savingsGoals]);

  const goToGoals = () => navigate('/goals');

  const cardProps = {
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': 'View all goals',
    onClick: goToGoals,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        goToGoals();
      }
    },
    className:
      'cursor-pointer transition-all active:scale-[0.98] hover:border-primary-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
  };

  return (
    <Card data-testid="goal-summary" {...cardProps}>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Target size={18} className="text-primary-500" />
          Goals
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-end justify-between mb-2">
          <div>
            <p className="text-xs font-medium uppercase text-gray-500">Active goals</p>
            <p className="text-2xl font-extrabold text-gray-900">{activeGoals.length}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium uppercase text-gray-500">Saved</p>
            <p className="font-bold text-gray-700">
              <CurrencyDisplay amountPence={totalSaved} forceColor={false} />
            </p>
          </div>
        </div>

        <Progress value={overallPct} max={100} color="primary" />

        {activeGoals.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {activeGoals.slice(0, 3).map(goal => {
              const pct = goal.targetAmountPence > 0
                ? Math.min(100, (goal.currentAmountPence / goal.targetAmountPence) * 100)
                : 0;
              return (
                <li key={goal.goalId || goal.title}>
                  <button
                    type="button"
                    className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-gray-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                    onClick={e => {
                      e.stopPropagation();
                      navigate(`/goals/${goal.goalId}`);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation();
                        navigate(`/goals/${goal.goalId}`);
                      }
                    }}
                    data-testid="goal-summary-item"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-gray-800 truncate">{goal.title}</span>
                      <span className="text-xs text-gray-500 shrink-0">{Math.round(pct)}%</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
                      <div className="h-1.5 rounded-full bg-primary-500" style={{ width: `${pct}%` }} />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-gray-500">No active goals yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
