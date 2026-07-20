import { Card, CardContent } from '../ui/Card';
import { Avatar } from '../ui/Avatar';
import { useTranslation } from 'react-i18next';

export function PetLeaderboard({
  fundTransactions,
  familyMembers,
  reversals = [],
  currencySymbol,
}: {
  fundTransactions: any[];
  familyMembers: any[];
  reversals?: any[];
  currencySymbol: string;
}) {
  const { t } = useTranslation('funds');
  // Build a set of reversed petbox_request source IDs
  // A petbox_request reversal has sourceKind === 'petbox_request'
  const reversedPetboxIds = new Set<string>(
    reversals
      .filter(r => r.sourceKind === 'petbox_request' && r.status === 'completed')
      .map(r => r.sourceId)
  );

  // Aggregate NET contributions by user, excluding refunded donations
  // fund_transactions of type 'contribution' link back to petbox_requests via tx.sourceId
  const contributions: Record<string, number> = {};

  fundTransactions.forEach(tx => {
    if (tx.type === 'contribution' && tx.fromUserId) {
      // Exclude this contribution if its backing petbox_request was refunded
      if (tx.sourceId && reversedPetboxIds.has(tx.sourceId)) return;
      contributions[tx.fromUserId] = (contributions[tx.fromUserId] || 0) + tx.amount;
    }
  });

  // Sort children by net contribution amount
  const sortedHelpers = familyMembers
    .filter(m => m.role === 'child' && contributions[m.id] > 0)
    .map(m => ({ ...m, totalContributed: contributions[m.id] }))
    .sort((a, b) => b.totalContributed - a.totalContributed);

  if (sortedHelpers.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-gray-500 font-medium">
          {t('noContributions')}
        </CardContent>
      </Card>
    );
  }

  const medals = ['🥇', '🥈', '🥉'];

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        {sortedHelpers.slice(0, 5).map((helper, idx) => (
          <div key={helper.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 flex items-center justify-center text-xl">
                {idx < 3 ? medals[idx] : <span className="text-gray-400 font-bold">{idx + 1}</span>}
              </div>
              <Avatar src={helper.avatarUrl} fallback={helper.displayName[0]} size="sm" />
              <span className="font-bold text-gray-900">{helper.displayName}</span>
            </div>
            <div className="text-right">
              <span className="font-extrabold text-reward-600">{currencySymbol}{(helper.totalContributed / 100).toFixed(2)}</span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
