import { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { useStore } from '../../store/useStore';
import { CurrencyDisplay } from '../ui/CurrencyDisplay';
import { Clock } from 'lucide-react';
import { approvalKey, type ApprovalType } from '../../lib/approvalContracts';
import {
  approveTaskCompletion,
  rejectTaskCompletion,
  approveTransferRequest,
  rejectTransferRequest,
  approveMoneyRequest,
  rejectMoneyRequest,
  approvePetBoxDonation,
  rejectPetBoxDonation,
  approveProfileUpdateRequest,
  rejectProfileUpdateRequest,
  approveGoalWithdrawal,
  rejectGoalWithdrawal,
} from '../../lib/api';
import { HistoryActionControl } from '../reversals/HistoryActionControl';
import type { ReversalSourceKind } from '../../lib/reversalApi';

export function ApprovalCenter() {
  const { t } = useTranslation('approvals');
  const { currentUser, tasks, familyMembers, taskCompletions, transferRequests, moneyRequests, petboxRequests, profileUpdateRequests, goalRequests, savingsGoals } = useStore();

  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');
  const [processing, setProcessing] = useState<Record<string, 'approve' | 'reject'>>({});
  const inFlightKeys = useRef(new Set<string>());
  const [optimisticallyRemovedIds, setOptimisticallyRemovedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  const timeline = useMemo(() => {
    let items: any[] = [];

    // 1. Task Completions
    items.push(...taskCompletions.map(c => ({
      ...c,
      category: 'task',
      sortDate: c.completedAt?.toDate ? c.completedAt.toDate() : new Date(),
      isPending: c.status === 'pending_approval'
    })));

    // 2. Transfer Requests
    items.push(...(transferRequests || []).map(r => ({
      ...r,
      category: 'transfer',
      sortDate: r.createdAt?.toDate ? r.createdAt.toDate() : new Date(),
      isPending: r.status === 'pending'
    })));

    // 3. Money Requests (from sibling or to parent)
    items.push(...(moneyRequests || []).map(r => ({
      ...r,
      category: 'money_request',
      sortDate: r.createdAt?.toDate ? r.createdAt.toDate() : new Date(),
      isPending: r.status === 'pending'
    })));

    // 4. Pet Box Requests
    items.push(...(petboxRequests || []).map(r => ({
      ...r,
      category: 'petbox',
      sortDate: r.createdAt?.toDate ? r.createdAt.toDate() : new Date(),
      isPending: r.status === 'pending'
    })));

    // 5. Profile Update Requests
    items.push(...(profileUpdateRequests || []).map(r => ({
      ...r,
      category: 'profile_update',
      sortDate: r.createdAt?.toDate ? r.createdAt.toDate() : new Date(),
      isPending: r.status === 'pending'
    })));

    // 6. Goal Requests (contribution approvals + withdrawal requests)
    items.push(...(goalRequests || []).map(r => {
      const goal = savingsGoals.find(g => g.id === r.goalId || g.goalId === r.goalId);
      return {
        ...r,
        category: 'goal',
        goalTitle: goal?.title ?? 'goal',
        sortDate: r.createdAt?.toDate ? r.createdAt.toDate() : new Date(),
        isPending: r.status === 'pending',
      };
    }));

    items.sort((a, b) => b.sortDate.getTime() - a.sortDate.getTime());
    return items;
  }, [taskCompletions, transferRequests, moneyRequests, petboxRequests, profileUpdateRequests, goalRequests, savingsGoals]);

  const itemKey = (item: any) => approvalKey(item.category as ApprovalType, item.id);
  const pendingApprovals = timeline.filter(item => item.isPending && !optimisticallyRemovedIds.has(itemKey(item)));
  const historyApprovals = timeline.filter(item => !item.isPending).slice(0, 20);

  useEffect(() => {
    const stillPending = new Set(timeline.filter(item => item.isPending).map(itemKey));
    setOptimisticallyRemovedIds(previous => {
      const reconciled = new Set([...previous].filter(key => stillPending.has(key)));
      return reconciled.size === previous.size ? previous : reconciled;
    });
  }, [timeline]);

  const errorText = (err: any) => `${err?.code ? `${err.code}: ` : ''}${err?.message || 'An error occurred.'}`;

  const handleApprove = async (item: any) => {
    if (!currentUser) return;
    const key = itemKey(item);
    if (inFlightKeys.current.has(key)) return;
    inFlightKeys.current.add(key);
    setProcessing(previous => ({ ...previous, [key]: 'approve' }));
    setError('');
    try {
      if (item.category === 'task') {
        await approveTaskCompletion(currentUser.familyId, item.id, '');
      } else if (item.category === 'transfer') {
        await approveTransferRequest(currentUser.familyId, item.id);
      } else if (item.category === 'money_request') {
        await approveMoneyRequest(currentUser.familyId, item.id);
      } else if (item.category === 'petbox') {
        await approvePetBoxDonation(currentUser.familyId, item.id);
      } else if (item.category === 'profile_update') {
        await approveProfileUpdateRequest(currentUser.familyId, item.id);
      } else if (item.category === 'goal') {
        // Only withdrawal requests require parent approval; contribution
        // requests are also surfaced here when approvalRequired was set.
        await approveGoalWithdrawal(currentUser.familyId, item.id, `${Date.now()}-${item.id}`);
      }
      setOptimisticallyRemovedIds(prev => new Set(prev).add(key));
    } catch (err: any) {
      setError(errorText(err));
    } finally {
      inFlightKeys.current.delete(key);
      setProcessing(previous => { const next = { ...previous }; delete next[key]; return next; });
    }
  };

  const handleReject = async (item: any) => {
    if (!currentUser) return;
    const key = itemKey(item);
    if (inFlightKeys.current.has(key)) return;
    const rejectionReason = 'Rejected';
    inFlightKeys.current.add(key);
    setProcessing(previous => ({ ...previous, [key]: 'reject' }));
    setError('');
    try {
      if (item.category === 'task') {
        await rejectTaskCompletion(currentUser.familyId, item.id, rejectionReason);
      } else if (item.category === 'transfer') {
        await rejectTransferRequest(currentUser.familyId, item.id, rejectionReason);
      } else if (item.category === 'money_request') {
        await rejectMoneyRequest(currentUser.familyId, item.id, rejectionReason);
      } else if (item.category === 'petbox') {
        await rejectPetBoxDonation(currentUser.familyId, item.id, rejectionReason);
      } else if (item.category === 'profile_update') {
        await rejectProfileUpdateRequest(currentUser.familyId, item.id, rejectionReason);
      } else if (item.category === 'goal') {
        await rejectGoalWithdrawal(currentUser.familyId, item.id, rejectionReason);
      }
      setOptimisticallyRemovedIds(prev => new Set(prev).add(key));
    } catch (err: any) {
      setError(errorText(err));
    } finally {
      inFlightKeys.current.delete(key);
      setProcessing(previous => { const next = { ...previous }; delete next[key]; return next; });
    }
  };

  const renderApprovalCard = (item: any) => {
    let title = '';
    let description = '';
    let amount = 0;
    let badge = null;
    let avatarSrc = '';
    let fallback = '';
    const sourceKindMap: Partial<Record<string, ReversalSourceKind>> = {
      task: 'task_completion',
      transfer: 'transfer_request',
      money_request: 'money_request',
      petbox: 'petbox_request',
      goal: 'goal_request',
    };
    const sourceKind = sourceKindMap[item.category];

    if (item.category === 'task') {
      const task = tasks.find(t => t.id === item.taskId);
      const child = familyMembers.find(c => c.id === item.assigneeId);
      title = t('type.taskCompletion');
      description = t('desc.taskCompletion', { childName: child?.displayName || '', taskTitle: task?.title || '' });
      badge = <Badge variant="primary" className="text-[10px]">+{task?.pointsReward} pts</Badge>;
      avatarSrc = child?.avatarUrl || '';
      fallback = child?.displayName[0] || '?';
    } else if (item.category === 'transfer') {
      const fromChild = familyMembers.find(c => c.id === item.fromChildId);
      const toChild = familyMembers.find(c => c.id === item.toChildId);
      title = t('type.transferRequest');
      description = item.message
        ? t('desc.transferRequestMessage', { fromName: fromChild?.displayName || '', toName: toChild?.displayName || '', message: item.message })
        : t('desc.transferRequest', { fromName: fromChild?.displayName || '', toName: toChild?.displayName || '' });
      amount = item.amountPence;
      avatarSrc = fromChild?.avatarUrl || '';
      fallback = fromChild?.displayName[0] || '?';
    } else if (item.category === 'money_request') {
      const requestedFrom = familyMembers.find(member => member.id === item.requestedFromId);
      const isFromParent = requestedFrom?.role === 'parent' || requestedFrom?.role === 'owner';
      title = isFromParent ? t('type.moneyRequest') : t('type.siblingMoneyRequest');

      if (isFromParent) {
        description = item.message
          ? t('desc.moneyRequestFromParentMessage', { requesterName: item.requesterName || '', message: item.message })
          : t('desc.moneyRequestFromParent', { requesterName: item.requesterName || '' });
      } else {
        description = item.message
          ? t('desc.moneyRequestSiblingMessage', { requestedFromName: item.requestedFromName || '', requesterName: item.requesterName || '', message: item.message })
          : t('desc.moneyRequestSibling', { requestedFromName: item.requestedFromName || '', requesterName: item.requesterName || '' });
      }
      amount = item.amountPence;
      avatarSrc = '';
      fallback = item.requesterName?.[0] || '?';
    } else if (item.category === 'petbox') {
      title = t('type.petBoxDonation');
      description = t('desc.petBoxDonation', { childName: item.childName || '', fundName: item.fundName || '' });
      amount = item.amountPence;
      avatarSrc = '';
      fallback = item.childName?.[0] || '?';
    } else if (item.category === 'profile_update') {
      const child = familyMembers.find(c => c.id === item.childId);
      const requestedName = item.requestedDisplayName || item.childName || child?.displayName || 'A child';
      const currentName = child?.displayName || item.childName || '';
      const nameChanged = requestedName && currentName && requestedName !== currentName;
      const avatarChanged = Boolean(item.requestedAvatarId) || Boolean(item.requestedAvatar);
      const changes: string[] = [];
      if (nameChanged) changes.push(t('change.name', { name: requestedName }));
      if (avatarChanged) changes.push(t('change.avatar'));
      title = t('type.profileUpdateRequest');
      description = t('desc.profileUpdate', {
        childName: item.childName || child?.displayName || 'A child',
        changes: changes.length ? ` (${changes.join(', ')})` : '',
      });
      avatarSrc = item.requestedAvatar || child?.avatarUrl || '';
      fallback = (item.childName || child?.displayName || '?')[0] || '?';
    } else if (item.category === 'goal') {
      const child = familyMembers.find(c => c.id === item.childId);
      const isWithdrawal = item.requestType === 'withdrawal';
      title = isWithdrawal ? t('type.goalWithdrawal') : t('type.goalContribution');
      description = isWithdrawal
        ? t('desc.goalWithdrawal', { childName: child?.displayName ?? 'A child', goalTitle: item.goalTitle || '' })
        : t('desc.goalContribution', { childName: child?.displayName ?? 'A child', goalTitle: item.goalTitle || '' });
      amount = item.amountPence;
      avatarSrc = child?.avatarUrl || '';
      fallback = (child?.displayName ?? '?')[0] || '?';
    }

    return (
      <Card key={`${item.category}-${item.id}`} className={item.isPending ? "border-warning-200 bg-warning-50/30" : "opacity-75"}>
        <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Avatar src={avatarSrc} fallback={fallback} size="sm" />
            <div>
              <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">{title}</h4>
              <p className="font-semibold text-gray-900 leading-tight mb-1">{description}</p>
              <div className="flex items-center gap-2">
                {amount > 0 && (
                  <span className="font-bold text-gray-900"><CurrencyDisplay amountPence={amount} forceColor={false} /></span>
                )}
                {badge}
              </div>
              <p className="text-xs text-gray-400 mt-2">{item.sortDate.toLocaleString()}</p>
            </div>
          </div>

          <div className="flex gap-2 shrink-0 self-end md:self-center">
            {item.isPending ? (
              <>
                <Button size="sm" variant="danger" disabled={itemKey(item) in processing} onClick={() => handleReject(item)}>
                  {processing[itemKey(item)] === 'reject' ? t('rejecting') : t('reject')}
                </Button>
                <Button size="sm" className="bg-success-500 hover:bg-success-600 text-white" disabled={itemKey(item) in processing} onClick={() => handleApprove(item)}>
                  {processing[itemKey(item)] === 'approve' ? t('approving') : t('approve')}
                </Button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Badge variant={item.status === 'approved' ? 'success' : 'danger'}>{item.status}</Badge>
                {sourceKind ? (
                  <HistoryActionControl sourceKind={sourceKind} source={item} />
                ) : null}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <section>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-3">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <Clock size={20} className="text-warning-500" />
          {t('title')}
        </h2>
        <div className="flex bg-gray-100 p-1 rounded-lg self-start sm:self-auto">
          <button
            onClick={() => setActiveTab('pending')}
            className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${activeTab === 'pending' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
          >
            {t('pendingCount', { count: pendingApprovals.length })}
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${activeTab === 'history' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
          >
            {t('historyTab')}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-danger-50 text-danger-600 rounded-xl text-sm font-medium">
          {error}
        </div>
      )}

      {activeTab === 'pending' ? (
        pendingApprovals.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500 shadow-sm">
            {t('emptyPending')}
          </div>
        ) : (
          <div className="space-y-3">
            {pendingApprovals.map(renderApprovalCard)}
          </div>
        )
      ) : (
        historyApprovals.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500 shadow-sm">
            {t('emptyHistory')}
          </div>
        ) : (
          <div className="space-y-3">
            {historyApprovals.map(renderApprovalCard)}
          </div>
        )
      )}
    </section>
  );
}
