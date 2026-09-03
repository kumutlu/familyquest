import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store/useStore';
import { PageLoader } from '../components/ui/PageLoader';
import { HelpButton } from '../help/components/HelpButton';
import { FamilyWorld } from '../components/family/FamilyWorld';
import { selectFamilyWorldViewModel } from '../lib/familyWorld/selectors';
import type { MemberSummary } from '../lib/familyWorld/types';
import { createChallenge, claimChallenge } from '../lib/api';
import { isParentRole, isOwnerRole } from '../lib/roles';
import { EditMemberModal } from '../components/family/EditMemberModal';
import { ChildLoginSection, type ChildLoginMember } from '../components/family/ChildLoginSection';
import { CreateChildLoginDialog } from '../components/family/CreateChildLoginDialog';
import { Toast, type ToastData } from '../components/ui/Toast';
import { AddChildModal } from '../components/family/AddChildModal';
import { InviteMemberCard } from '../components/dashboard/InviteMemberCard';
import { Button } from '../components/ui/Button';
import { Plus, UserPlus, ChevronDown, ChevronUp, QrCode } from 'lucide-react';
import { ConnectChildDeviceQrModal } from '../components/ConnectChildDeviceQrModal';


import { useNavigate } from 'react-router-dom';


export function Family() {
  const { t } = useTranslation(['family', 'familyWorld', 'common']);
  const { t: tCommon } = useTranslation('common');
  const navigate = useNavigate();

  const {
    currentUser,
    familyMembers,
    loading,
    tasks,
    taskCompletions,
    challenges,
    gamificationSummaries,
    walletTransactions,
    childWallets,
  } = useStore();

  const [editingMember, setEditingMember] = useState<any>(null);
  const [createLoginFor, setCreateLoginFor] = useState<ChildLoginMember | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [isChallengeModalOpen, setIsChallengeModalOpen] = useState(false);
  const [challengeData, setChallengeData] = useState({
    title: 'Weekend Warriors',
    targetXP: 500,
    ['rewardPoints']: 100,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddChildOpen, setIsAddChildOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [showAdvancedManagement, setShowAdvancedManagement] = useState(false);


  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') =>
    setToast({ id: Date.now(), message, type });

  if (loading) return <PageLoader label={t('loading')} />;

  const viewModel = selectFamilyWorldViewModel({
    familyMembers,
    currentUser,
    tasks,
    taskCompletions,
    challenges,
    gamificationSummaries,
    transactions: walletTransactions,
    childWallets,
  });

  const handleClaimQuest = async (questId: string) => {
    if (!currentUser) return;
    setIsSubmitting(true);
    try {
      await claimChallenge(currentUser.familyId, questId);
      showToast(t('familyWorld:quest.targetReached', 'Target reached!'), 'success');
    } catch (e) {
      console.error(e);
      showToast(t('challenge.claimFailed'), 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    setIsSubmitting(true);
    try {
      const eligibleChildren = familyMembers.filter(
        (c) => c.role === 'child' && c.status !== 'deleted' && c.status !== 'disabled' && !c.disabled,
      );
      const xpByChild = new Map((gamificationSummaries || []).map((s: any) => [s.id, s.xpTotal ?? 0]));
      const totalFamilyXP = eligibleChildren.reduce((acc, child) => {
        const summaryXp = xpByChild.get(child.id);
        return acc + (typeof summaryXp === 'number' ? summaryXp : (child.lifetimeXP || 0));
      }, 0);

      await createChallenge(
        currentUser.familyId,
        challengeData.title,
        Number(challengeData.targetXP),
        Number((challengeData as any)['rewardPoints']),
        totalFamilyXP,
      );
      setIsChallengeModalOpen(false);
      showToast(t('familyWorld:quest.title', 'Family Quest'), 'success');
    } catch (e) {
      console.error(e);
      showToast('Failed to create challenge', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendMoney = (member: MemberSummary) => {
    navigate(`/wallet?action=send&recipient=${member.id}`);
  };

  const isParent = isParentRole(currentUser?.role);
  const isOwner = isOwnerRole(currentUser?.role);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header with Quick Actions */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              {t('familyWorld:title', 'Family World')}
            </h1>
            <HelpButton />
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
            {t('familyWorld:subtitle', 'Our shared adventures, quests, and moments')}
          </p>
        </div>

        {/* Parent Header Actions */}
        {isParent && (
          <div className="flex flex-wrap items-center gap-2">
            {!viewModel.activeFamilyQuest && (
              <Button
                onClick={() => setIsChallengeModalOpen(true)}
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-sm flex items-center gap-1.5 text-xs"
              >
                <Plus size={15} />
                <span>{t('familyWorld:quest.startTitle', 'New Family Quest')}</span>
              </Button>
            )}

            {isOwner && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsQrModalOpen(true)}
                  className="rounded-xl border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950 text-xs font-semibold"
                >
                  <QrCode size={15} className="mr-1 shrink-0" />
                  <span>Connect Child Device</span>
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsAddChildOpen(true)}
                  className="rounded-xl border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold"
                >
                  <UserPlus size={15} className="mr-1 shrink-0" />
                  {t('addChild')}
                </Button>
              </>
            )}


            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsInviteOpen(true)}
              className="rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 text-xs font-semibold"
            >
              <UserPlus size={15} className="mr-1 shrink-0" />
              {t('inviteMember')}
            </Button>
          </div>
        )}
      </header>

      {/* Primary Experience: Queki v2 Living Family World */}
      <FamilyWorld
        viewModel={viewModel}
        onClaimQuest={handleClaimQuest}
        isClaimingQuest={isSubmitting}
        onManageFamily={() => setShowAdvancedManagement((prev) => !prev)}
        onSendMoney={handleSendMoney}
      />

      {/* Progressive Disclosure: Member Management & Child Logins (for Parents/Owners) */}
      {isParent && (
        <div className="pt-2">
          <button
            onClick={() => setShowAdvancedManagement((prev) => !prev)}
            className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200 transition-colors mx-auto py-2"
          >
            <span>
              {showAdvancedManagement
                ? t('familyWorld:manage', 'Hide member management')
                : t('familyWorld:manage', 'Member accounts & settings')}
            </span>
            {showAdvancedManagement ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {showAdvancedManagement && (
            <div className="mt-4 p-5 rounded-3xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/80 space-y-4">
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-600 dark:text-slate-300">
                {t('familyWorld:manage', 'Managed Member Accounts')}
              </h4>

              <div className="space-y-3">
                {familyMembers.map((member) => (
                  <div
                    key={member.id}
                    className="p-3.5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-500/10 text-blue-600 font-bold flex items-center justify-center text-xs">
                        {member.displayName?.[0]?.toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-sm text-slate-900 dark:text-white">
                            {member.displayName}
                          </span>
                          <span className="text-[10px] uppercase font-bold px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                            {member.role}
                          </span>
                        </div>
                        {member.role === 'child' && member.isManaged && (
                          <ChildLoginSection
                            member={member}
                            onRequestCreate={(m) => setCreateLoginFor(m)}
                          />
                        )}
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingMember(member)}
                      className="text-xs font-semibold text-slate-600 dark:text-slate-300"
                    >
                      {t('edit')}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create Challenge Modal */}
      {isChallengeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-800 w-full sm:max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col border border-slate-200 dark:border-slate-700 animate-in fade-in duration-200">
            <div className="px-6 py-4 flex justify-between items-center border-b border-slate-100 dark:border-slate-700">
              <h3 className="text-lg font-black text-slate-900 dark:text-white">
                {t('newChallenge.title')}
              </h3>
              <button
                onClick={() => setIsChallengeModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 hover:bg-slate-200"
              >
                ✕
              </button>
            </div>
            <div className="p-6">
              <form onSubmit={handleCreateChallenge} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {t('newChallenge.challengeTitle')}
                  </label>
                  <input
                    type="text"
                    required
                    value={challengeData.title}
                    onChange={(e) => setChallengeData({ ...challengeData, title: e.target.value })}
                    className="block w-full px-3 py-2 text-sm rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {t('newChallenge.xpTarget')}
                  </label>
                  <input
                    type="number"
                    required
                    min="10"
                    value={challengeData.targetXP}
                    onChange={(e) =>
                      setChallengeData({ ...challengeData, targetXP: Number(e.target.value) })
                    }
                    className="block w-full px-3 py-2 text-sm rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1">
                    {t('newChallenge.xpTargetHelp')}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    {t('newChallenge.rewardPerChild')}
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={(challengeData as any)['rewardPoints']}
                    onChange={(e) => {
                      const pointsVal = Number(e.target.value);
                      setChallengeData((prev) => ({ ...prev, ['rewardPoints']: pointsVal }));
                    }}
                    className="block w-full px-3 py-2 text-sm rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1">
                    {t('newChallenge.rewardPerChildHelp')}
                  </p>
                </div>
                <div className="pt-2">
                  <Button
                    type="submit"
                    fullWidth
                    disabled={isSubmitting}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl py-2.5"
                  >
                    {isSubmitting ? t('newChallenge.starting') : t('newChallenge.start')}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Edit Member Modal */}
      {editingMember && (
        <EditMemberModal
          member={editingMember}
          onClose={() => setEditingMember(null)}
        />
      )}

      {/* Create Child Login Dialog */}
      {createLoginFor && (
        <CreateChildLoginDialog
          member={createLoginFor}
          onClose={() => setCreateLoginFor(null)}
          onSuccess={() => {
            const name = createLoginFor?.displayName ?? 'child';
            setCreateLoginFor(null);
            showToast(t('loginCreated', { name }));
          }}
        />
      )}

      {/* Add Child Modal */}
      {isAddChildOpen && currentUser?.familyId && (
        <AddChildModal
          familyId={currentUser.familyId}
          onClose={() => setIsAddChildOpen(false)}
          onChildAdded={() => {
            showToast(t('childAdded'));
          }}
        />
      )}

      {/* Invite Member Modal */}
      {isInviteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
          onClick={() => setIsInviteOpen(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setIsInviteOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('invite.title')}
            tabIndex={-1}
            ref={(node) => node?.focus()}
            onClick={(event) => event.stopPropagation()}
            className="bg-white dark:bg-slate-800 w-full sm:max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col focus:outline-none border border-slate-200 dark:border-slate-700"
          >
            <div className="flex items-center justify-end px-4 pt-3">
              <button
                onClick={() => setIsInviteOpen(false)}
                aria-label={tCommon('closeDialog')}
                className="h-9 w-9 flex items-center justify-center bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-full text-slate-500"
              >
                ✕
              </button>
            </div>
            <div className="px-5 pb-6 pt-1">
              <InviteMemberCard
                onManagedChild={() => {
                  setIsInviteOpen(false);
                  setIsAddChildOpen(true);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Connect Child Device QR Modal */}
      <ConnectChildDeviceQrModal
        isOpen={isQrModalOpen}
        onClose={() => setIsQrModalOpen(false)}
      />

      {/* Toast */}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
