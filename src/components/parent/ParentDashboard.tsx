import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import { Card, CardContent } from '../ui/Card';
import { PageLoader } from '../ui/PageLoader';
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
import { RewardsSummaryCard } from '../dashboard/RewardsSummaryCard';
import { PetBoxSummaryCard } from '../dashboard/PetBoxSummaryCard';
import { isPetBoxEnabled } from '../../lib/familyFeatures';
import { FamilyBulletin } from '../bulletin/FamilyBulletin';
import { FamilySetupPrompt } from '../family/FamilySetupPrompt';
import { AddChildModal } from '../family/AddChildModal';
import { shouldShowFamilySetupPrompt } from '../../lib/familySetup';
import { FocusModeDashboard } from './dashboard/FocusModeDashboard';
import { getFocusModeState, isFamilySetupComplete } from '../../lib/focusMode';

const joinRequestProcessingKey = (request: { id: string; uid: string }) => `join:${request.id}:${request.uid}`;

export function ParentDashboard() {
  const { t } = useTranslation('dashboard');
  const { t: tAuth } = useTranslation('auth');
  const {
    currentUser,
    familyMembers,
    familyData,
    joinRequests,
    rewards = [],
    tasks = [],
    loading,
    bootstrapError,
    appReady,
    familyLoading,
    bootstrapStatus,
  } = useStore();
  const [setupPromptHidden, setSetupPromptHidden] = useState(false);

  const [joinProcessing, setJoinProcessing] = useState<Record<string, 'approve' | 'reject'>>({});
  const [joinError, setJoinError] = useState('');
  const [approvalRoles, setApprovalRoles] = useState<Record<string, 'child' | 'parent'>>({});
  const joinInFlight = useRef(new Set<string>());

  const [isAddChildOpen, setIsAddChildOpen] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isRewardModalOpen, setIsRewardModalOpen] = useState(false);
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);

  if (loading || !currentUser) {
    return <PageLoader label={t('loading')} />;
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
      if (action === 'approve') {
        const selectedRole = approvalRoles[request.id] ?? 'child';
        if (
          selectedRole === 'parent' &&
          !window.confirm(t('joinRequests.parentWarning'))
        ) return;
        await approveJoinRequest(currentUser.familyId, request.id, selectedRole);
      }
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

  const petBoxEnabled = isPetBoxEnabled(familyData);
  const summaryCols = petBoxEnabled ? 'lg:grid-cols-4' : 'lg:grid-cols-3';

  const focus = getFocusModeState({ familyMembers, rewards, tasks, joinRequests, currentUser });
  const setupComplete = isFamilySetupComplete({ familyMembers, rewards, tasks });

  // Focus Mode: while setup is incomplete, suppress every non-essential
  // dashboard section and show a single guided next action instead.
  if (focus.isFocusMode) {
    return (
      <div data-testid="dashboard-focus-mode">
        <FocusModeDashboard onAddChild={() => setIsAddChildOpen(true)} />

        {isAddChildOpen && (
          <AddChildModal
            familyId={currentUser.familyId}
            onClose={() => setIsAddChildOpen(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-300 pb-8">
      <DashboardHeader />

      {/* Onboarding surfaces live in Focus Mode only. An activated family (or a
          family whose data is still hydrating) never sees the guided next
          action, the "You're all set" card or the large Invite Member card
          here; invites remain available via Family → Invite Member and
          Settings. */}

      <QuickActions
        onNewTask={() => setIsTaskModalOpen(true)}
        onNewReward={() => setIsRewardModalOpen(true)}
        onLogBehaviour={() => setIsEventModalOpen(true)}
      />

      <PendingApprovalsSection />

      <FamilyBulletin />

      {/* Compact family summaries (Phase 3): reuse Phase 2 summary cards.
          These render the parent/owner aggregate views and link to the
          management screens. Children never see this surface. */}
      <section className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${summaryCols}`}>
        <WalletSummaryCard />
        <GoalSummaryCard />
        <RewardsSummaryCard />
        {petBoxEnabled && <PetBoxSummaryCard />}
      </section>

      {/* Join Requests (owner only) */}
      {joinRequests && joinRequests.some((request: any) => request.status === 'pending') && currentUser.role === 'owner' && (
        <section className="rounded-2xl border border-primary-100 bg-primary-50 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-primary-900">
            <UserPlus size={20} />
            {t('joinRequests.heading')}
          </h2>
          <p className="mb-3 text-sm text-primary-800">
            {t('joinRequests.roleHelp')}
          </p>
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
                        <>
                          <select
                            aria-label={`Approval role for ${req.displayName}`}
                            value={approvalRoles[req.id] ?? 'child'}
                            onChange={event => setApprovalRoles(previous => ({
                              ...previous,
                              [req.id]: event.target.value as 'child' | 'parent',
                            }))}
                            className="rounded-lg border border-primary-200 bg-white px-2 text-sm"
                          >
                            <option value="child">{t('joinRequests.approveChild')}</option>
                            <option value="parent">{t('joinRequests.approveParent')}</option>
                          </select>
                          <Button size="sm" disabled={processingKey in joinProcessing} onClick={() => reviewJoin(req, 'approve')}>
                            {joinProcessing[processingKey] === 'approve'
                              ? t('joinRequests.approving')
                              : t(
                                (approvalRoles[req.id] ?? 'child') === 'parent'
                                  ? 'joinRequests.confirmParent'
                                  : 'joinRequests.confirmChild',
                              )}
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      <div className="flex justify-end">
        <Button size="sm" onClick={() => setIsAddChildOpen(true)}>
          {tAuth('familySetup.addChild')}
        </Button>
      </div>

      <ChildrenOverview />

      <RecentActivity />

      <ReversalHistoryPanel />

      {!setupPromptHidden && !setupComplete && shouldShowFamilySetupPrompt({
        appReady,
        familyLoading,
        familyData,
        familyMembers,
        currentUser,
        bootstrapStatus,
      }) && (
        <FamilySetupPrompt
          familyId={currentUser.familyId}
          ownerId={currentUser.uid || currentUser.id}
          familyCode={familyData?.inviteCode || ''}
          familyMembers={familyMembers}
          onHide={() => setSetupPromptHidden(true)}
        />
      )}

      {isAddChildOpen && (
        <AddChildModal
          familyId={currentUser.familyId}
          onClose={() => setIsAddChildOpen(false)}
        />
      )}

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
