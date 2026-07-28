import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import { Card, CardContent } from '../ui/Card';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { approveJoinRequest, rejectJoinRequest } from '../../lib/api';
import { UserPlus } from 'lucide-react';
import { useRef, useState } from 'react';
import { TaskFormModal } from '../forms/TaskFormModal';
import { RewardFormModal } from '../forms/RewardFormModal';
import { BehaviourFormModal } from '../forms/BehaviourFormModal';
import { ReversalHistoryPanel } from '../reversals/ReversalHistoryPanel';
import { DashboardHeader } from './dashboard/DashboardHeader';
import { QuickActions } from './dashboard/QuickActions';
import { PendingApprovalsSection } from './dashboard/PendingApprovalsSection';
import { ChildrenOverview } from './dashboard/ChildrenOverview';
import { RecentActivity } from './dashboard/RecentActivity';
import { WalletSummaryCard } from '../dashboard/WalletSummaryCard';
import { GoalSummaryCard } from '../dashboard/GoalSummaryCard';
import { PetBoxSummaryCard } from '../dashboard/PetBoxSummaryCard';
import { isPetBoxEnabled } from '../../lib/familyFeatures';

const joinRequestProcessingKey = (request: { id: string; uid: string }) => `join:${request.id}:${request.uid}`;

export function ParentDashboard() {
  const { t } = useTranslation('dashboard');
  const { currentUser, familyMembers, familyData, joinRequests, loading, bootstrapError } = useStore();

  const [joinProcessing, setJoinProcessing] = useState<Record<string, 'approve' | 'reject'>>({});
  const [joinError, setJoinError] = useState('');
  const joinInFlight = useRef(new Set<string>());

  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isRewardModalOpen, setIsRewardModalOpen] = useState(false);
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);

  if (loading || !currentUser) {
    return <div className="p-8 text-center text-gray-500 animate-pulse">{t('loading')}</div>;
  }

  if (bootstrapError) {
    // Never surface raw Firebase errors to parents; log detail for debugging.
    console.error('[ParentDashboard] bootstrap failed:', bootstrapError);
    return (
      <div className="p-8 text-center" role="alert">
        <p className="font-semibold text-gray-700">{t('loadError.title')}</p>
        <p className="mt-1 text-sm text-gray-500">{t('loadError.subtitle')}</p>
      </div>
    );
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
        await rejectJoinRequest(currentUser.familyId, request.id, 'Rejected');
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

  return (
    <div className="space-y-8 animate-in fade-in duration-300 pb-8">
      <DashboardHeader />

      <QuickActions
        petBoxEnabled={isPetBoxEnabled(familyData)}
        onNewTask={() => setIsTaskModalOpen(true)}
        onNewReward={() => setIsRewardModalOpen(true)}
        onLogBehaviour={() => setIsEventModalOpen(true)}
      />

      <PendingApprovalsSection />

      {/* Compact family summaries (Phase 3): reuse Phase 2 summary cards.
          These render the parent/owner aggregate views and link to the
          management screens. Children never see this surface. */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <WalletSummaryCard />
        <GoalSummaryCard />
        {isPetBoxEnabled(familyData) && <PetBoxSummaryCard />}
      </section>

      {/* Join Requests (owner only) */}
      {joinRequests && joinRequests.some((request: any) => request.status === 'pending') && currentUser.role === 'owner' && (
        <section className="rounded-2xl border border-primary-100 bg-primary-50 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-primary-900">
            <UserPlus size={20} />
            {t('joinRequests.heading')}
          </h2>
          {joinError && <div className="mb-3 rounded-lg bg-danger-50 p-3 text-sm font-medium text-danger-600">{joinError}</div>}
          <div className="space-y-3">
            {joinRequests.filter((request: any) => request.status === 'pending').map((req: any) => {
              const processingKey = joinRequestProcessingKey(req);
              return (
                <Card key={req.id} className="border-primary-200">
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <Avatar src={`https://api.dicebear.com/7.x/bottts/svg?seed=${req.displayName}`} fallback={req.displayName[0]} size="sm" />
                      <div>
                        <h4 className="font-semibold text-gray-900">{req.displayName}</h4>
                        <p className="text-xs font-medium text-gray-500">
                          {req.claimCode ? t('joinRequests.claimProfile') : t('joinRequests.joinFamily')}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" disabled={processingKey in joinProcessing} onClick={() => reviewJoin(req, 'reject')}>
                        {joinProcessing[processingKey] === 'reject' ? t('joinRequests.rejecting') : t('joinRequests.reject')}
                      </Button>
                      {!req.claimCode && (
                        <Button size="sm" disabled={processingKey in joinProcessing} onClick={() => reviewJoin(req, 'approve')}>
                          {joinProcessing[processingKey] === 'approve' ? t('joinRequests.approving') : t('joinRequests.approve')}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      <ChildrenOverview />

      <RecentActivity />

      <ReversalHistoryPanel />

      {/* Forms / modals (reused, not duplicated) */}
      <BehaviourFormModal
        isOpen={isEventModalOpen}
        onClose={() => setIsEventModalOpen(false)}
        childrenList={children}
      />
      <TaskFormModal isOpen={isTaskModalOpen} onClose={() => setIsTaskModalOpen(false)} />
      <RewardFormModal isOpen={isRewardModalOpen} onClose={() => setIsRewardModalOpen(false)} />
    </div>
  );
}
