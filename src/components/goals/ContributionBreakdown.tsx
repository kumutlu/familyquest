import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '../ui/Card';
import { CurrencyDisplay } from '../ui/CurrencyDisplay';
import { useStore } from '../../store/useStore';
import {
  computeNetChild,
  type ContributionLeg,
  type Goal,
} from '../../lib/goalContracts';

/**
 * Contribution breakdown derived purely from the goal-specific immutable
 * `contributions` ledger (design §2.2 / §7). Ownership is never inferred from
 * wallet_transactions.
 */
export function ContributionBreakdown({ goal, contributions }: {
  goal: Goal;
  contributions: ContributionLeg[];
}) {
  const { familyMembers, currentUser } = useStore();
  const { t } = useTranslation('goals');

  const breakdown = useMemo(() => {
    let childTotal = 0;
    let parentTotal = 0;
    let autoMatch = 0;
    let manualMatch = 0;
    const perChild = new Map<string, number>();

    for (const c of contributions) {
      if (c.status && c.status !== 'applied') continue;
      const amt = c.amountPence;
      switch (c.type) {
        case 'child_contribution':
          childTotal += amt;
          perChild.set(c.ownerId, (perChild.get(c.ownerId) ?? 0) + amt);
          break;
        case 'parent_contribution':
          parentTotal += amt;
          break;
        case 'auto_match':
          autoMatch += amt;
          break;
        case 'manual_match':
          manualMatch += amt;
          break;
        // withdrawals / refunds / external_closure are excluded from the
        // "who funded this" breakdown (they are outflows / closures).
        default:
          break;
      }
    }
    return { childTotal, parentTotal, autoMatch, manualMatch, perChild };
  }, [contributions]);

  const nameOf = (id: string) => familyMembers.find(m => m.id === id)?.displayName ?? t('breakdown.child');

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <h3 className="font-bold text-gray-900">{t('breakdown.title')}</h3>

        <Row label={t('breakdown.childSavings')} value={breakdown.childTotal} tone="child" />
        <Row label={t('breakdown.parentContributions')} value={breakdown.parentTotal} tone="parent" />
        <Row label={t('breakdown.autoMatches')} value={breakdown.autoMatch} tone="match" />
        <Row label={t('breakdown.manualMatches')} value={breakdown.manualMatch} tone="match" />

        {goal.kind === 'child' && goal.childId && (
          <div className="pt-2 border-t border-gray-100">
            <p className="text-xs text-gray-500 font-medium uppercase mb-1">{t('breakdown.yourNet')}</p>
            <p className="font-bold text-gray-900">
              <CurrencyDisplay amountPence={computeNetChild(contributions, goal.childId)} forceColor={false} />
            </p>
          </div>
        )}

        {breakdown.perChild.size > 1 && (
          <div className="pt-2 border-t border-gray-100 space-y-1">
            <p className="text-xs text-gray-500 font-medium uppercase mb-1">{t('breakdown.perChild')}</p>
            {[...breakdown.perChild.entries()].map(([id, amt]) => (
              <div key={id} className="flex justify-between text-sm">
                <span className="text-gray-600">{nameOf(id)}</span>
                <span className="font-semibold text-gray-800"><CurrencyDisplay amountPence={amt} forceColor={false} /></span>
              </div>
            ))}
          </div>
        )}

        {currentUser?.role === 'parent' || currentUser?.role === 'owner' ? null : null}
      </CardContent>
    </Card>
  );
}

function Row({ label, value, tone }: { label: string; value: number; tone: 'child' | 'parent' | 'match' }) {
  const dot = tone === 'child' ? 'bg-primary-500' : tone === 'parent' ? 'bg-warning-500' : 'bg-success-500';
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-sm text-gray-600">
        <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
        {label}
      </span>
      <span className="font-semibold text-gray-800"><CurrencyDisplay amountPence={value} forceColor={false} /></span>
    </div>
  );
}
