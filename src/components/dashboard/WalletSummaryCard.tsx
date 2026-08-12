import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { CurrencyDisplay } from '../ui/CurrencyDisplay';
import { useStore } from '../../store/useStore';
import { isParentRole } from '../../lib/roles';
import { Wallet as WalletIcon } from 'lucide-react';

/**
 * Compact wallet summary for the Home dashboard.
 *
 * Permission boundaries are preserved:
 *  - Children see ONLY their own wallet balance and a link to /wallet.
 *  - Parents/owners see an aggregate of the children's wallets and a link to
 *    /wallets (the parent wallet management screen). Children never see the
 *    parent management surface.
 *
 * The whole card is now tappable (keyboard accessible) and the redundant ghost
 * arrow button has been removed.
 */
export function WalletSummaryCard() {
  const navigate = useNavigate();
  const { currentUser, myWallet, childWallets, familyMembers, bootstrapStatus } = useStore();

  if (!currentUser) return null;

  if (bootstrapStatus?.wallets === 'loading' || bootstrapStatus?.members === 'loading') {
    return <Card data-testid="wallet-summary-loading" aria-busy="true" className="h-36 animate-pulse bg-gray-100" />;
  }
  if (bootstrapStatus?.wallets === 'error' || bootstrapStatus?.members === 'error') {
    return (
      <Card data-testid="wallet-summary-error" role="status" className="p-4 text-sm text-gray-500">
        Wallet details are temporarily unavailable.
      </Card>
    );
  }

  const isParent = isParentRole(currentUser.role);

  const go = () => navigate(isParent ? '/wallets' : '/wallet');

  const cardProps = {
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': isParent ? 'Manage family wallets' : 'Open my wallet',
    onClick: go,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go();
      }
    },
    className:
      'cursor-pointer transition-all active:scale-[0.98] hover:border-primary-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
  };

  if (isParent) {
    const childMemberIds = new Set(familyMembers.filter(m => m.role === 'child').map(m => m.id));
    const wallets = (childWallets || []).filter((w: any) => childMemberIds.has(w.id));
    const totalBalance = wallets.reduce((sum: number, w: any) => sum + (w.balance || 0), 0);
    const linkedCount = wallets.length;
    const memberCount = familyMembers.filter(m => m.role === 'child').length;

    return (
      <Card data-testid="wallet-summary" {...cardProps}>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <WalletIcon size={18} className="text-primary-500" />
            Family Wallets
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs font-medium uppercase text-gray-500">Total children balance</p>
          <p className="text-2xl font-extrabold text-gray-900">
            <CurrencyDisplay amountPence={totalBalance} forceColor={false} />
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {linkedCount} of {memberCount} child {memberCount === 1 ? 'wallet' : 'wallets'} linked
          </p>
        </CardContent>
      </Card>
    );
  }

  // Child view: only their own wallet.
  const balance = myWallet?.balance || 0;

  return (
    <Card data-testid="wallet-summary" {...cardProps}>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <WalletIcon size={18} className="text-primary-500" />
          My Wallet
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs font-medium uppercase text-gray-500">Current balance</p>
        <p className="text-2xl font-extrabold text-success-600">
          <CurrencyDisplay amountPence={balance} forceColor={false} />
        </p>
      </CardContent>
    </Card>
  );
}
