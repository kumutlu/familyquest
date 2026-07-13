import { useStore } from '../../store/useStore';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { approveJoinRequest, rejectJoinRequest, depositToWallet, withdrawFromWallet, transferWalletFunds, } from '../../lib/api';
import { Plus, Zap, Gift, Users, UserPlus, Wallet as WalletIcon, ArrowRightLeft, ArrowDownToLine, ArrowUpFromLine, TrendingUp, TrendingDown } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CurrencyDisplay } from '../ui/CurrencyDisplay';
import { TaskFormModal } from '../forms/TaskFormModal';
import { RewardFormModal } from '../forms/RewardFormModal';
import { BehaviourFormModal } from '../forms/BehaviourFormModal';
import { Stat } from '../ui/Stat';
import { ApprovalCenter } from './ApprovalCenter';
import { ReversalHistoryPanel } from '../reversals/ReversalHistoryPanel';

const joinRequestProcessingKey = (request: { id: string; uid: string }) => `join:${request.id}:${request.uid}`;

export function ParentDashboard() {
  const { currentUser, familyData, tasks, familyMembers, joinRequests, feed, rewards, childWallets, walletTransactions, loading } = useStore();
  const currencySymbol = familyData?.currency || '£';

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [joinProcessing, setJoinProcessing] = useState<Record<string, 'approve' | 'reject'>>({});
  const [joinError, setJoinError] = useState('');
  const joinInFlight = useRef(new Set<string>());

  const [isEventModalOpen, setIsEventModalOpen] = useState(false);

  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [walletAction, setWalletAction] = useState<'deposit' | 'withdraw' | 'transfer'>('deposit');
  const [walletData, setWalletData] = useState({ childId: '', toChildId: '', amount: '', note: '' });

  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isRewardModalOpen, setIsRewardModalOpen] = useState(false);

  if (loading || !currentUser) {
    return <div className="p-8 text-center text-gray-500 animate-pulse">Loading Dashboard...</div>;
  }

  const children = familyMembers.filter(m => m.role === 'child');

  const reviewJoin = async (request: any, action: 'approve' | 'reject') => {
    const key = joinRequestProcessingKey(request);
    if (joinInFlight.current.has(key)) return;
    joinInFlight.current.add(key);
    setJoinProcessing(previous => ({ ...previous, [key]: action }));
    setJoinError('');
    try {
      if (action === 'approve') await approveJoinRequest(currentUser.familyId, request.id, 'child');
      else {
        const reason = window.prompt('Enter a rejection reason')?.trim();
        if (!reason) return;
        await rejectJoinRequest(currentUser.familyId, request.id, reason);
      }
    } catch (error: any) {
      setJoinError(`${error?.code ? `${error.code}: ` : ''}${error?.message || 'Join review failed.'}`);
    } finally {
      joinInFlight.current.delete(key);
      setJoinProcessing(previous => {
        const next = { ...previous };
        delete next[key];
        return next;
      });
    }
  };



  const handleWalletAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !walletData.childId) return;
    const amountInCents = Math.round(Number(walletData.amount) * 100);
    if (amountInCents <= 0) return;

    setIsSubmitting(true);
    try {
      if (walletAction === 'deposit') {
        await depositToWallet(currentUser.familyId, walletData.childId, currentUser.id, amountInCents, walletData.note || 'Deposit');
      } else if (walletAction === 'withdraw') {
        await withdrawFromWallet(currentUser.familyId, walletData.childId, currentUser.id, amountInCents, walletData.note || 'Withdrawal');
      } else if (walletAction === 'transfer') {
        if (!walletData.toChildId || walletData.childId === walletData.toChildId) throw new Error("Invalid transfer");
        await transferWalletFunds(currentUser.familyId, walletData.childId, walletData.toChildId, currentUser.id, amountInCents, walletData.note || 'Transfer');
      }
      setIsWalletModalOpen(false);
      setWalletData({ childId: '', toChildId: '', amount: '', note: '' });
    } catch (err: any) {
      alert(err.message);
    }
    setIsSubmitting(false);
  };

  const totalFamilySavings = children.reduce((acc, child) => {
    const wallet = childWallets.find(w => w.id === child.id);
    return acc + (wallet?.balance ?? child.walletBalance ?? 0);
  }, 0);
  const totalTasks = tasks.filter(t => t.isActive !== false).length;
  const totalRewards = rewards.filter(r => r.isActive !== false).length;

  return (
    <div className="space-y-8 animate-in fade-in duration-300 pb-8">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Parent Console</h1>
        <p className="text-gray-500 mt-1">Manage your family's progress.</p>
      </header>

      {/* Overview Cards */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Link to="/tasks" className="contents">
          <Stat label="Tasks" value={totalTasks} icon={<Zap className="text-primary-500" />} />
        </Link>
        <Link to="/rewards" className="contents">
          <Stat label="Rewards" value={totalRewards} icon={<Gift className="text-reward-500" />} />
        </Link>
        <Link to="/family" className="contents">
          <Stat label="Children" value={children.length} icon={<Users className="text-success-500" />} />
        </Link>
        <Stat label="Family Savings" value={<CurrencyDisplay amountPence={totalFamilySavings} />} icon={<WalletIcon className="text-success-500" />} />
      </section>

      {/* Quick Actions */}
      <section>
        <div className="flex gap-2">
          <button onClick={() => setIsTaskModalOpen(true)} className="flex-1 bg-primary-50 hover:bg-primary-100 transition-colors rounded-lg py-2 flex items-center justify-center text-primary-700 text-xs font-bold">
            <Plus size={16} className="mr-1" /> New Task
          </button>
          <button onClick={() => setIsRewardModalOpen(true)} className="flex-1 bg-reward-50 hover:bg-reward-100 transition-colors rounded-lg py-2 flex items-center justify-center text-reward-700 text-xs font-bold">
            <Gift size={16} className="mr-1" /> New Reward
          </button>
          <button onClick={() => setIsEventModalOpen(true)} className="flex-1 bg-warning-50 hover:bg-warning-100 transition-colors rounded-lg py-2 flex items-center justify-center text-warning-700 text-xs font-bold">
            <Zap size={16} className="mr-1" /> Log Event
          </button>
          <button onClick={() => setIsWalletModalOpen(true)} className="flex-1 bg-success-50 hover:bg-success-100 transition-colors rounded-lg py-2 flex items-center justify-center text-success-700 text-xs font-bold">
            <WalletIcon size={16} className="mr-1" /> Wallet
          </button>
        </div>
      </section>

      {/* Join Requests */}
      {joinRequests && joinRequests.some((request: any) => request.status === 'pending') && currentUser.role === 'owner' && (
        <section className="bg-primary-50 rounded-2xl p-4 border border-primary-100">
          <h2 className="text-lg font-bold text-primary-900 mb-3 flex items-center gap-2">
            <UserPlus size={20} />
            Pending Join Requests
          </h2>
          {joinError && <div className="mb-3 rounded-lg bg-danger-50 p-3 text-sm font-medium text-danger-600">{joinError}</div>}
          <div className="space-y-3">
            {joinRequests.filter((request: any) => request.status === 'pending').map((req: any) => {
              const processingKey = joinRequestProcessingKey(req);
              return (
              <Card key={req.id} className="border-primary-200">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar src={`https://api.dicebear.com/7.x/bottts/svg?seed=${req.displayName}`} fallback={req.displayName[0]} size="sm" />
                    <div>
                      <h4 className="font-semibold text-gray-900">{req.displayName}</h4>
                      <p className="text-xs text-gray-500 font-medium">
                        {req.claimCode ? 'Wants to claim a managed profile' : 'Wants to join the family'}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" disabled={processingKey in joinProcessing} onClick={() => reviewJoin(req, 'reject')}>
                      {joinProcessing[processingKey] === 'reject' ? 'Rejecting…' : 'Reject'}
                    </Button>
                    {!req.claimCode && (
                      <Button size="sm" disabled={processingKey in joinProcessing} onClick={() => reviewJoin(req, 'approve')}>
                        {joinProcessing[processingKey] === 'approve' ? 'Approving…' : 'Approve as Child'}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )})}
          </div>
        </section>
      )}

      <ApprovalCenter />
      <ReversalHistoryPanel />

      {/* Child Summaries */}
      {children.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Users size={20} className="text-primary-500" />
            Child Summaries
          </h2>
          <div className="space-y-3">
            {children.map(child => (
              <Link key={child.id} to={`/family/${child.id}`} className="block">
                <Card className="hover:border-primary-300 transition-colors">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Avatar src={child.avatarUrl} fallback={child.displayName[0]} />
                      <div>
                        <h4 className="font-bold text-gray-900">{child.displayName}</h4>
                        <p className="text-sm text-gray-500 font-medium">Lvl {Math.floor((child.lifetimeXP || 0) / 1000) + 1} • {child.currentStreak || 0} Day Streak</p>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <div className="text-center">
                        <p className="text-xs text-gray-500 uppercase font-bold tracking-wider">Wallet</p>
                        <p className="text-xs mt-1"><CurrencyDisplay amountPence={childWallets.find(w => w.id === child.id)?.balance ?? child.walletBalance ?? 0} className="font-bold" /></p>
                      </div>
                      <div className="text-center border-l border-gray-100 pl-4">
                        <p className="text-xs text-gray-500 uppercase font-bold tracking-wider">Points</p>
                        <p className="text-xs mt-1 font-bold text-primary-600">{child.rewardPoints || 0}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}
      {/* Family Activity */}
      {feed.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-4">Recent Activity</h2>
          <div className="bg-white rounded-2xl border border-gray-100 p-1">
            {feed.slice(0, 5).map((item) => {
              const isBehaviour = item.type === 'behaviour';
              const date = item.timestamp?.toDate ? item.timestamp.toDate().toLocaleString() : '';

              if (isBehaviour) {
                return (
                  <div key={item.id} className="p-4 flex items-center justify-between border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900">{item.text.split(':')[0]}: {item.reason}</h4>
                      <p className="text-xs text-gray-400 mt-1">{date}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {item.behaviourType === 'financial' ? (
                        <Badge variant="default" className="flex items-center gap-1 bg-warning-100 text-warning-700">
                          <TrendingDown size={12} /> <CurrencyDisplay amountPence={item.walletDelta} forceColor={false} />
                        </Badge>
                      ) : item.pointsDelta >= 0 ? (
                        <Badge variant="default" className="flex items-center gap-1 bg-green-100 text-green-700">
                          <TrendingUp size={12} /> +{item.pointsDelta}
                        </Badge>
                      ) : (
                        <Badge variant="default" className="flex items-center gap-1 bg-red-100 text-red-700">
                          <TrendingDown size={12} /> {item.pointsDelta}
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              }

              return (
                <div key={item.id} className="p-4 flex items-start gap-3 border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                  <div className="w-2 h-2 rounded-full bg-primary-400 mt-2 shrink-0"></div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{item.text}</p>
                    <span className="text-xs text-gray-400 mt-1">{date}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {/* Cross-Family Wallet History */}
      {walletTransactions.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-4">Wallet Transactions</h2>
          <div className="bg-white rounded-2xl border border-gray-100 p-1">
            {walletTransactions.slice(0, 10).map((tx) => {
              const child = familyMembers.find(m => m.id === tx.childId);
              let txTitle = tx.note || tx.type;
              if (tx.type === 'transfer_out') txTitle = `Transfer to ${familyMembers.find(m => m.id === tx.counterpartyChildId)?.displayName || 'sibling'}`;
              if (tx.type === 'transfer_in') txTitle = `Transfer from ${familyMembers.find(m => m.id === tx.counterpartyChildId)?.displayName || 'sibling'}`;

              const isCredit = tx.type === 'deposit' || tx.type === 'transfer_in' || tx.type === 'credit' || (tx.type === 'transfer' && tx.amount > 0 && !tx.fromChildId);
              const txAmount = Math.abs(tx.amountPence || tx.amount || 0);
              const date = tx.timestamp?.toDate ? tx.timestamp.toDate().toLocaleString() : (tx.createdAt?.toDate ? tx.createdAt.toDate().toLocaleString() : '');

              return (
                <div key={tx.id} className="p-4 flex items-center justify-between border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900">{child?.displayName || 'Child'} - {txTitle}</h4>
                    <p className="text-xs text-gray-400 mt-1">{date}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="default" className={`flex items-center gap-1 ${isCredit ? 'bg-success-100 text-success-700' : 'bg-danger-100 text-danger-700'}`}>
                      {isCredit ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      {isCredit ? '+' : '-'}<CurrencyDisplay amountPence={txAmount} forceColor={false} />
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {/* Log Behaviour Event Modal */}
      <BehaviourFormModal
        isOpen={isEventModalOpen}
        onClose={() => setIsEventModalOpen(false)}
        childrenList={children}
      />

      {/* Wallet Management Modal */}
      {isWalletModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-xl overflow-hidden flex flex-col max-h-[90vh] animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-10 duration-300">
            <div className="px-6 py-4 flex justify-between items-center border-b border-gray-100">
              <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2"><WalletIcon size={20} className="text-success-500" /> Manage Wallet</h3>
              <button onClick={() => setIsWalletModalOpen(false)} className="p-2 -mr-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-500">✕</button>
            </div>

            <div className="flex border-b border-gray-100">
              <button
                onClick={() => setWalletAction('deposit')}
                className={`flex-1 py-3 text-sm font-medium flex justify-center items-center gap-2 ${walletAction === 'deposit' ? 'text-success-600 border-b-2 border-success-600' : 'text-gray-500'}`}
              >
                <ArrowDownToLine size={16} /> Deposit
              </button>
              <button
                onClick={() => setWalletAction('withdraw')}
                className={`flex-1 py-3 text-sm font-medium flex justify-center items-center gap-2 ${walletAction === 'withdraw' ? 'text-danger-600 border-b-2 border-danger-600' : 'text-gray-500'}`}
              >
                <ArrowUpFromLine size={16} /> Withdraw
              </button>
              {children.length > 1 && (
                <button
                  onClick={() => setWalletAction('transfer')}
                  className={`flex-1 py-3 text-sm font-medium flex justify-center items-center gap-2 ${walletAction === 'transfer' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`}
                >
                  <ArrowRightLeft size={16} /> Transfer
                </button>
              )}
            </div>

            <div className="p-6 overflow-y-auto">
              <form onSubmit={handleWalletAction} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">{walletAction === 'transfer' ? 'From Child' : 'Child'}</label>
                  <select required value={walletData.childId} onChange={e => setWalletData({...walletData, childId: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md bg-white">
                    <option value="" disabled>Select a child</option>
                    {children.map(c => (
                      <option key={c.id} value={c.id}>{c.displayName} (<CurrencyDisplay amountPence={childWallets.find(w => w.id === c.id)?.balance ?? c.walletBalance ?? 0} />)</option>
                    ))}
                  </select>
                </div>

                {walletAction === 'transfer' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700">To Child</label>
                    <select required value={walletData.toChildId} onChange={e => setWalletData({...walletData, toChildId: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md bg-white">
                      <option value="" disabled>Select a child</option>
                      {children.filter(c => c.id !== walletData.childId).map(c => (
                        <option key={c.id} value={c.id}>{c.displayName} (<CurrencyDisplay amountPence={childWallets.find(w => w.id === c.id)?.balance ?? c.walletBalance ?? 0} />)</option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700">Amount ({currencySymbol})</label>
                  <input type="number" step="0.01" min="0.01" required placeholder="0.00" value={walletData.amount} onChange={e => setWalletData({...walletData, amount: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Note</label>
                  <input type="text" required placeholder="e.g. Weekly Allowance" value={walletData.note} onChange={e => setWalletData({...walletData, note: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
                </div>

                <div className="pt-4">
                  <Button type="submit" fullWidth disabled={isSubmitting} className={walletAction === 'deposit' ? "bg-success-500 hover:bg-success-600" : walletAction === 'withdraw' ? "bg-danger-500 hover:bg-danger-600" : "bg-primary-500 hover:bg-primary-600"}>
                    {isSubmitting ? 'Processing...' : walletAction === 'deposit' ? 'Add Money' : walletAction === 'withdraw' ? 'Remove Money' : 'Transfer Money'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Forms */}
      <TaskFormModal isOpen={isTaskModalOpen} onClose={() => setIsTaskModalOpen(false)} />
      <RewardFormModal isOpen={isRewardModalOpen} onClose={() => setIsRewardModalOpen(false)} />
    </div>
  );
}
