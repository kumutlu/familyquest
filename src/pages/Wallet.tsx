import { useState } from 'react';
import { Card, CardContent } from '../components/ui/Card';
import { Stat } from '../components/ui/Stat';
import { ArrowDownRight, ArrowUpRight, Wallet as WalletIcon, Target } from 'lucide-react';
import { useStore } from '../store/useStore';
import { TransactionDetailsModal } from '../components/wallet/TransactionDetailsModal';

export function Wallet() {
  const { currentUser, walletTransactions, loading } = useStore();
  const [selectedTransaction, setSelectedTransaction] = useState<any>(null);

  if (loading || !currentUser) return <div className="p-8 text-center text-gray-500 animate-pulse">Loading Wallet...</div>;

  const currentBalance = currentUser.walletBalance || 0; // Stored in cents

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Wallet</h1>
        <p className="text-gray-500 mt-1">Manage your allowance.</p>
      </header>

      <div className="bg-gray-900 p-6 rounded-3xl text-white shadow-lg relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 opacity-10">
          <WalletIcon size={120} strokeWidth={1} />
        </div>
        <div className="relative z-10">
          <p className="text-gray-400 font-medium text-sm mb-1 uppercase tracking-wider">Total Balance</p>
          <h2 className="text-4xl font-extrabold tracking-tight">${(currentBalance / 100).toFixed(2)}</h2>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Placeholder for future V2 goals, just showing static zero for MVP as goals are removed from schema */}
        <Stat label="Saved this month" value="$0.00" icon={<Target className="text-primary-500" />} />
        <Stat label="Spent this month" value="$0.00" icon={<ArrowDownRight className="text-danger-500" />} />
      </div>

      <section className="mt-8">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Recent Transactions</h3>
        
        {walletTransactions.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500">
            No transactions yet.
          </div>
        ) : (
          <Card>
            <CardContent className="p-2">
              <div className="divide-y divide-gray-50">
                {walletTransactions.map((tx) => {
                  const isCredit = tx.type === 'credit';
                  const date = tx.timestamp?.toDate ? tx.timestamp.toDate() : new Date();
                  return (
                    <div
                      key={tx.id}
                      onClick={() => setSelectedTransaction(tx)}
                      className="p-3 flex cursor-pointer items-center justify-between transition-colors hover:bg-gray-50"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isCredit ? 'bg-success-50 text-success-600' : 'bg-gray-100 text-gray-600'}`}>
                          {isCredit ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900 text-sm">{tx.description}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{date.toLocaleDateString()}</p>
                        </div>
                      </div>
                      <div className={`font-bold ${isCredit ? 'text-success-600' : 'text-gray-900'}`}>
                        {isCredit ? '+' : '-'}${(tx.amount / 100).toFixed(2)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </section>
      <TransactionDetailsModal
        isOpen={!!selectedTransaction}
        onClose={() => setSelectedTransaction(null)}
        transaction={selectedTransaction}
      />
    </div>
  );
}
