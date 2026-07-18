import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  collection, onSnapshot, query, orderBy,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useStore } from '../store/useStore';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Progress } from '../components/ui/Progress';
import { Badge } from '../components/ui/Badge';
import { CurrencyDisplay } from '../components/ui/CurrencyDisplay';
import { ContributionBreakdown } from '../components/goals/ContributionBreakdown';
import { ContributionModal } from '../components/goals/ContributionModal';
import { ParentContributionModal } from '../components/goals/ParentContributionModal';
import { WithdrawalRequestModal } from '../components/goals/WithdrawalRequestModal';
import { MatchProposalModal } from '../components/goals/MatchProposalModal';
import {
  completeGoalPurchased, returnGoalFunds, cancelGoal,
  approveMatchProposal, rejectMatchProposal,
} from '../lib/api';
import {
  normalizeGoalDoc, computeNetChild,
  type ContributionLeg, type Goal, type GoalStatus, type MatchProposal,
} from '../lib/goalContracts';
import { isParentRole } from '../lib/roles';
import { ArrowLeft, CheckCircle2, RotateCcw, XCircle, Gift, HandCoins, LogOut, Sparkles } from 'lucide-react';

const STATUS_LABEL: Record<GoalStatus, string> = {
  active: 'Active',
  reached: 'Reached 🎉',
  completed_purchased: 'Purchased',
  completed_returned: 'Returned',
  cancelled: 'Cancelled',
};

export function GoalDetail() {
  const { goalId } = useParams<{ goalId: string }>();
  const navigate = useNavigate();
  const { currentUser, familyData, savingsGoals, familyMembers } = useStore();
  const isParent = isParentRole(currentUser?.role);

  const rawGoal = savingsGoals.find(g => g.id === goalId || g.goalId === goalId);
  const goal: Goal | null = rawGoal ? normalizeGoalDoc(rawGoal) : null;

  const [contributions, setContributions] = useState<ContributionLeg[]>([]);
  const [proposals, setProposals] = useState<MatchProposal[]>([]);
  const [showContribute, setShowContribute] = useState(false);
  const [showParent, setShowParent] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [showMatch, setShowMatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Live listeners for the per-goal contributions ledger and match proposals.
  useEffect(() => {
    if (!familyData || !goalId) return;
    const base = `families/${familyData.id}/savings_goals/${goalId}`;
    const cUnsub = onSnapshot(
      query(collection(db, `${base}/contributions`), orderBy('createdAt', 'desc')),
      snap => setContributions(snap.docs.map(d => ({ ...(d.data() as ContributionLeg), contribId: d.id }))),
    );
    const pUnsub = onSnapshot(
      query(collection(db, `${base}/match_proposals`), orderBy('createdAt', 'desc')),
      snap => setProposals(snap.docs.map(d => ({ ...(d.data() as MatchProposal), proposalId: d.id }))),
    );
    return () => { cUnsub(); pUnsub(); };
  }, [familyData, goalId]);

  const isTerminal = useMemo(() => {
    if (!goal) return false;
    return ['completed_purchased', 'completed_returned', 'cancelled'].includes(goal.status);
  }, [goal]);

  const isReached = goal?.status === 'reached';
  const canAct = goal && (goal.status === 'active' || goal.status === 'reached') && !isTerminal;

  const childId = goal?.kind === 'child' ? (goal.childId ?? currentUser?.id ?? '') : '';
  const netChild = goal ? computeNetChild(contributions, childId) : 0;

  const runParentAction = async (fn: () => Promise<unknown>, label: string) => {
    if (!familyData || !goal) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err: any) {
      setError(err?.message || `Could not ${label}.`);
    } finally {
      setBusy(false);
    }
  };

  if (!goal) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate('/goals')}><ArrowLeft size={16} className="mr-1" /> Back</Button>
        <Card><CardContent className="p-8 text-center text-gray-500">Goal not found.</CardContent></Card>
      </div>
    );
  }

  const pct = goal.targetAmountPence > 0 ? Math.min(100, (goal.currentAmountPence / goal.targetAmountPence) * 100) : 0;
  const pendingProposals = proposals.filter(p => p.status === 'proposed');

  return (
    <div className="space-y-6">
      <Button variant="ghost" onClick={() => navigate('/goals')}><ArrowLeft size={16} className="mr-1" /> Goals</Button>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-extrabold text-gray-900">{goal.title}</h1>
              <p className="text-sm text-gray-500 mt-1">
                {goal.kind === 'family' ? '👨‍👩‍👧‍👦 Family goal' : `🎯 ${familyMembers.find(m => m.id === goal.childId)?.displayName ?? 'Child'} goal`}
              </p>
            </div>
            <Badge variant={isTerminal ? 'default' : isReached ? 'success' : 'primary'}>{STATUS_LABEL[goal.status]}</Badge>
          </div>

          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs text-gray-500 font-medium uppercase">Saved</p>
              <p className="text-3xl font-extrabold text-gray-900"><CurrencyDisplay amountPence={goal.currentAmountPence} forceColor={false} /></p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500 font-medium uppercase">Target</p>
              <p className="font-bold text-gray-700"><CurrencyDisplay amountPence={goal.targetAmountPence} forceColor={false} /></p>
            </div>
          </div>
          <Progress value={pct} max={100} color={isReached ? 'success' : 'primary'} />

          {isReached && !isTerminal && (
            <div className="bg-success-50 border border-success-200 rounded-xl p-3 flex items-center gap-2 text-success-700 text-sm font-medium">
              <CheckCircle2 size={18} /> Target reached! You can keep saving or complete this goal.
            </div>
          )}
          {isTerminal && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm text-gray-600 font-medium">
              This goal is {STATUS_LABEL[goal.status].toLowerCase()} and is now closed.
            </div>
          )}

          {error && <p className="text-sm text-danger-600 font-medium">{error}</p>}

          {/* Action buttons */}
          {canAct && (
            <div className="flex flex-wrap gap-2 pt-2">
              {goal.kind === 'child' && goal.childId === currentUser?.id && (
                <Button onClick={() => setShowContribute(true)}><HandCoins size={16} className="mr-1" /> Contribute</Button>
              )}
              {isParent && goal.kind === 'family' && (
                <Button onClick={() => setShowContribute(true)}><HandCoins size={16} className="mr-1" /> Contribute</Button>
              )}
              {isParent && (
                <Button variant="secondary" onClick={() => setShowParent(true)}><Gift size={16} className="mr-1" /> Add Parent Money</Button>
              )}
              {goal.kind === 'child' && goal.childId === currentUser?.id && netChild > 0 && (
                <Button variant="outline" onClick={() => setShowWithdraw(true)}><LogOut size={16} className="mr-1" /> Withdraw</Button>
              )}
              {isParent && (
                <Button variant="outline" onClick={() => setShowMatch(true)}><Sparkles size={16} className="mr-1" /> Propose Match</Button>
              )}
            </div>
          )}

          {/* Parent terminal actions */}
          {isParent && canAct && (
            <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
              <Button variant="primary" size="sm" disabled={busy} onClick={() => runParentAction(() => completeGoalPurchased(familyData.id, goal.goalId!, `${Date.now()}`), 'complete')}>
                <CheckCircle2 size={14} className="mr-1" /> Mark Purchased
              </Button>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => runParentAction(() => returnGoalFunds(familyData.id, goal.goalId!, `${Date.now()}`), 'return')}>
                <RotateCcw size={14} className="mr-1" /> Return Funds
              </Button>
              <Button variant="danger" size="sm" disabled={busy} onClick={() => runParentAction(() => cancelGoal(familyData.id, goal.goalId!, `${Date.now()}`), 'cancel')}>
                <XCircle size={14} className="mr-1" /> Cancel
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <ContributionBreakdown goal={goal} contributions={contributions} />

      {/* Pending match proposals (parent review inline) */}
      {isParent && pendingProposals.length > 0 && (
        <Card>
          <CardContent className="p-5 space-y-3">
            <h3 className="font-bold text-gray-900">Pending Match Proposals</h3>
            {pendingProposals.map(p => (
              <div key={p.proposalId} className="flex items-center justify-between bg-gray-50 rounded-xl p-3">
                <span className="font-semibold text-gray-800">
                  <CurrencyDisplay amountPence={p.proposedMatchAmountPence} forceColor={false} /> match
                </span>
                <div className="flex gap-2">
                  <Button variant="danger" size="sm" disabled={busy} onClick={() => runParentAction(() => rejectMatchProposal(familyData.id, goal.goalId!, p.proposalId!), 'reject match')}>Reject</Button>
                  <Button size="sm" disabled={busy} onClick={() => runParentAction(() => approveMatchProposal(familyData.id, goal.goalId!, p.proposalId!, `${Date.now()}-${p.proposalId}`), 'approve match')}>Approve</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {showContribute && (
        <ContributionModal goal={goal} isOpen={showContribute} onClose={() => setShowContribute(false)} />
      )}
      {showParent && (
        <ParentContributionModal goal={goal} isOpen={showParent} onClose={() => setShowParent(false)} />
      )}
      {showWithdraw && (
        <WithdrawalRequestModal goal={goal} contributions={contributions} isOpen={showWithdraw} onClose={() => setShowWithdraw(false)} />
      )}
      {showMatch && (
        <MatchProposalModal goal={goal} contributions={contributions} isOpen={showMatch} onClose={() => setShowMatch(false)} />
      )}
    </div>
  );
}
