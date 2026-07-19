import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { CurrencyDisplay } from '../ui/CurrencyDisplay';
import { useStore } from '../../store/useStore';
import { isParentRole } from '../../lib/roles';
import { Wallet as WalletIcon, ArrowRight } from 'lucide-react';

/**
 * Compact wallet summary for the Home dashboard.
 *
 * Permission boundaries are preserved:
 *  - Children see ONLY their own wallet balance and a link to /wallet.
 *  - Parents/owners see an aggregate of the children's wallets and a link to
 *    /wallets (the parent wallet management screen). Children never see the
 *    parent management surface.
 */
export function WalletSummaryCard() {
  const navigate = useNavigate();
  const { currentUser, myWallet, childWallets, familyMembers } = useStore();

  if (!currentUser) return null;

  const isParent = isParentRole(currentUser.role);

  if (isParent) {
    const wallets = childWallets || [];
    const totalBalance = wallets.reduce((sum: number, w: any) => sum + (w.balance || 0), 0);
    const linkedCount = wallets.length;
    const memberCount = familyMembers.filter(m => m.role === 'child').length;

    return (
      <Card data-testid="wallet-summary">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <WalletIcon size={18} className="text-primary-500" />
            Family Wallets
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="text-primary-600"
            onClick={() => navigate('/wallets')}
            data-testid="wallet-summary-link"
          >
            Manage <ArrowRight size={16} />
          </Button>
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
    <Card data-testid="wallet-summary">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <WalletIcon size={18} className="text-primary-500" />
          My Wallet
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          className="text-primary-600"
          onClick={() => navigate('/wallet')}
          data-testid="wallet-summary-link"
        >
          Open <ArrowRight size={16} />
        </Button>
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
