import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '../../ui/Card';
import { Avatar } from '../../ui/Avatar';
import { CurrencyDisplay } from '../../ui/CurrencyDisplay';
import { Flame, Star, Wallet, ListChecks } from 'lucide-react';

export interface ChildSummaryCardProps {
  child: any;
  /**
   * Canonical wallet balance in pence, sourced from
   * families/{familyId}/wallets/{childId}.balance.
   * `null` means the canonical wallet document is missing/unavailable
   * (never fall back to a legacy profile balance).
   */
  walletBalance: number | null;
  pendingTaskCount: number;
}

export function ChildSummaryCard({ child, walletBalance, pendingTaskCount }: ChildSummaryCardProps) {
  const { t } = useTranslation('dashboard');
  const level = Math.floor((child.lifetimeXP || 0) / 1000) + 1;
  const points = child.rewardPoints || 0;
  const streak = child.currentStreak || 0;
  const displayName = child.displayName || 'Child';

  return (
    <Link
      to={`/family/${child.id}`}
      aria-label={t('childCard.viewProfileAria', { name: displayName })}
      className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    >
      <Card className="h-full transition-colors hover:border-primary-300">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <Avatar src={child.avatarUrl} fallback={displayName[0] || '?'} size="md" />
            <div className="min-w-0">
              <h3 className="truncate font-bold text-gray-900">{displayName}</h3>
              <p className="text-xs font-medium text-gray-500">{t('childCard.level', { level })}</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{t('childCard.points')}</p>
              <p className="flex items-center justify-center gap-1 font-bold text-gray-900">
                <Star size={12} className="text-reward-500" />
                {points}
              </p>
            </div>
            <div className="border-x border-gray-100">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{t('childCard.wallet')}</p>
              <p className="flex items-center justify-center gap-1 font-bold text-success-600">
                <Wallet size={12} />
                {walletBalance === null ? (
                  <span className="text-xs font-semibold text-gray-400">{t('childCard.unavailable')}</span>
                ) : (
                  <CurrencyDisplay amountPence={walletBalance} forceColor={false} />
                )}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{t('childCard.streak')}</p>
              <p className="flex items-center justify-center gap-1 font-bold text-gray-900">
                <Flame size={12} className="text-warning-500" />
                {streak}
              </p>
            </div>
          </div>

          {pendingTaskCount > 0 && (
            <p className="mt-3 flex items-center gap-1 text-xs text-gray-500">
              <ListChecks size={12} />
              {t('childCard.pendingTasks', { count: pendingTaskCount })}
            </p>
          )}

          <p className="mt-3 text-sm font-semibold text-primary-600">{t('childCard.viewProfile')}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
