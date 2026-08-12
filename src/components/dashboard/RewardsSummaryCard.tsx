import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { useStore } from '../../store/useStore';
import { Gift } from 'lucide-react';

/**
 * Compact rewards summary for the parent Home dashboard.
 *
 * Shows the total number of rewards and links to /rewards.
 */
export function RewardsSummaryCard() {
  const navigate = useNavigate();
  const { rewards, bootstrapStatus } = useStore();

  if (bootstrapStatus?.rewards === 'loading') {
    return <Card data-testid="rewards-summary-loading" aria-busy="true" className="h-36 animate-pulse bg-gray-100" />;
  }
  if (bootstrapStatus?.rewards === 'error') {
    return (
      <Card data-testid="rewards-summary-error" role="status" className="p-4 text-sm text-gray-500">
        Rewards are temporarily unavailable.
      </Card>
    );
  }

  const rewardCount = (rewards || []).length;

  const goToRewards = () => navigate('/rewards');

  const cardProps = {
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': 'Manage rewards',
    onClick: goToRewards,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        goToRewards();
      }
    },
    className:
      'cursor-pointer transition-all active:scale-[0.98] hover:border-primary-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
  };

  return (
    <Card data-testid="rewards-summary" {...cardProps}>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gift size={18} className="text-reward-500" />
          Rewards
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs font-medium uppercase text-gray-500">Total rewards</p>
        <p className="text-2xl font-extrabold text-gray-900">{rewardCount}</p>
        <p className="mt-1 text-xs text-primary-600 font-medium">Manage rewards</p>
      </CardContent>
    </Card>
  );
}
