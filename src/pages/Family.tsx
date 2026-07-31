import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HelpButton } from '../help/components/HelpButton';
import { Avatar } from '../components/ui/Avatar';
import { PageLoader } from '../components/ui/PageLoader';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Crown, ChevronRight, Trophy, History, Target, Plus, UserPlus } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { Progress } from '../components/ui/Progress';
import { createChallenge, claimChallenge } from '../lib/api';
import { isChildRole, isParentRole, isOwnerRole, getRoleLabel } from '../lib/roles';
import { formatNumber } from '../i18n/format';
import { localWeekKey } from '../lib/taskRecurrence';
import { useRecurrenceClock } from '../lib/useRecurrenceClock';
import { EditMemberModal } from '../components/family/EditMemberModal';
import { ChildLoginSection, type ChildLoginMember } from '../components/family/ChildLoginSection';
import { CreateChildLoginDialog } from '../components/family/CreateChildLoginDialog';
import { Toast, type ToastData } from '../components/ui/Toast';
import { AddChildModal } from '../components/family/AddChildModal';

export function Family() {
  const { t } = useTranslation('family');
  const { currentUser, familyMembers, loading, tasks, taskCompletions, challenges } = useStore();
  const [activeTab, setActiveTab] = useState<'current' | 'history'>('current');
  
  const [editingMember, setEditingMember] = useState<any>(null);

  const [createLoginFor, setCreateLoginFor] = useState<ChildLoginMember | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') =>
    setToast({ id: Date.now(), message, type });

  const [isChallengeModalOpen, setIsChallengeModalOpen] = useState(false);
  const [challengeData, setChallengeData] = useState({ title: 'Weekend Warriors', targetXP: 500, rewardPoints: 100 });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isAddChildOpen, setIsAddChildOpen] = useState(false);

  // Open-session clock: rolls the weekly scoreboard over on Monday while the
  // app stays open (no full reload needed).
  const now = useRecurrenceClock();

  if (loading) return <PageLoader label={t('loading')} />;

  // Calculate "Weekly XP" for each member — the current local Mon–Sun week.
  // Uses the SAME Monday-based week key as recurring weekly tasks, so the
  // scoreboard rolls over every Monday by derivation (no destructive reset
  // job, and lifetime XP / wallet balances are never touched).
  const currentWeekKey = localWeekKey(now);

  const children = familyMembers.filter(m => isChildRole(m.role));
  const membersWithWeeklyXP = children.map(member => {
    let weeklyXP = 0;

    // Add approved task points earned this week
    const memberTasks = taskCompletions.filter(c =>
      c.assigneeId === member.id &&
      c.status === 'approved' &&
      c.approvedAt &&
      localWeekKey(c.approvedAt.toDate()) === currentWeekKey
    );
    memberTasks.forEach(c => {
      const task = tasks.find(t => t.id === c.taskId);
      if (task) weeklyXP += (task.pointsReward || 0);
    });

    return { ...member, weeklyXP };
  });

  const sortedMembers = [...membersWithWeeklyXP].sort((a, b) => b.weeklyXP - a.weeklyXP);
  // Only declare someone a champion if they actually earned points
  const champion = sortedMembers.length > 0 && sortedMembers[0].weeklyXP > 0 ? sortedMembers[0] : null;

  
  const activeChallenge = challenges?.find(c => c.isActive);
  
  // Calculate Family XP (total of all children)
  const totalFamilyXP = children.reduce((acc, child) => acc + (child.lifetimeXP || 0), 0);
  
  let challengeProgress = 0;
  if (activeChallenge) {
    const earnedSinceStart = Math.max(0, totalFamilyXP - (activeChallenge.startXP || 0));
    challengeProgress = Math.min(100, (earnedSinceStart / activeChallenge.targetXP) * 100);
  }

  const handleCreateChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    setIsSubmitting(true);
    try {
      await createChallenge(currentUser.familyId, challengeData.title, Number(challengeData.targetXP), Number(challengeData.rewardPoints), totalFamilyXP);
      setIsChallengeModalOpen(false);
    } catch (e) {
      console.error(e);
    }
    setIsSubmitting(false);
  };

  const handleClaimChallenge = async () => {
    if (!currentUser || !activeChallenge) return;
    setIsSubmitting(true);
    try {
      const childIds = children.map(c => c.id);
      await claimChallenge(currentUser.familyId, activeChallenge.id, activeChallenge.rewardPoints, childIds, activeChallenge.title);
    } catch (e) {
      console.error(e);
    }
    setIsSubmitting(false);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{t('title')}</h1>
            <HelpButton />
          </div>
          <p className="text-gray-500 mt-1">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isParentRole(currentUser?.role) && !activeChallenge && (
            <Button
              onClick={() => setIsChallengeModalOpen(true)}
              size="sm"
              aria-label={t('newChallenge.title')}
              className="bg-primary-500 rounded-full h-9 w-9 p-0 shadow-md flex items-center justify-center shrink-0"
            >
              <Plus size={18} />
            </Button>
          )}
          {isOwnerRole(currentUser?.role) && (
            <>
              <Button variant="outline" size="sm" onClick={() => setIsAddChildOpen(true)} className="border-primary-300 text-primary-700 hover:bg-primary-50 whitespace-nowrap">
                <UserPlus size={16} className="mr-1 shrink-0" />
                {t('addChild')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => {
                const inviteCode = document.querySelector('[data-invite-code]') as HTMLElement;
                if (inviteCode) {
                  navigator.clipboard.writeText(inviteCode.textContent || '');
                  showToast(t('inviteCopied'));
                }
              }} className="bg-primary-50 text-primary-700 border-primary-300 hover:bg-primary-100 whitespace-nowrap">
                <UserPlus size={16} className="mr-1 shrink-0" />
                {t('inviteMember')}
              </Button>
            </>
          )}
        </div>
      </header>

      {/* Active Family Challenge */}
      {activeChallenge && (
        <Card className="bg-primary-500 text-white border-none shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-20">
            <Target size={64} />
          </div>
          <CardContent className="p-6 relative z-10">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="default" className="bg-primary-400 text-white border-none">{t('challenge.badge')}</Badge>
            </div>
            <h3 className="text-xl font-bold tracking-tight mb-4">{activeChallenge.title}</h3>
            
            <div className="mb-2 flex justify-between text-sm font-medium">
              <span>{t('challenge.percentComplete', { percent: Math.floor(challengeProgress) })}</span>
              <span>{t('challenge.rewardEach', { points: activeChallenge.rewardPoints })}</span>
            </div>
            <Progress value={challengeProgress} className="h-2 bg-primary-700 [&>div]:bg-white mb-4" />
            
            {challengeProgress >= 100 && isParentRole(currentUser?.role) && (
              <Button onClick={handleClaimChallenge} disabled={isSubmitting} fullWidth className="bg-white text-primary-600 hover:bg-primary-50 font-bold shadow-md">
                {isSubmitting ? t('challenge.claiming') : t('challenge.claim')}
              </Button>
            )}
            {challengeProgress >= 100 && isChildRole(currentUser?.role) && (
              <p className="text-sm font-bold text-center bg-primary-600/50 py-2 rounded-lg">{t('challenge.goalReached')}</p>
            )}
          </CardContent>
        </Card>
      )}

      {champion && (
        <div className="bg-gradient-to-br from-reward-400 to-reward-500 p-6 rounded-3xl text-white shadow-lg relative overflow-hidden">
          <div className="relative z-10 flex items-center justify-between">
            <div>
              <p className="text-reward-100 font-medium text-sm mb-1 uppercase tracking-wider">{t('topEarner.label')}</p>
              <h2 className="text-3xl font-extrabold tracking-tight">{champion.displayName}!</h2>
              <p className="mt-2 text-sm opacity-90 font-medium">{t('topEarner.leading')}</p>
            </div>
            <Crown size={64} className="text-white opacity-80" strokeWidth={1.5} />
          </div>
        </div>
      )}

      {/* Parents Section */}
      <div className="mb-6">
        <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
          {t('adults')}
        </h3>
        <div className="space-y-3">
          {familyMembers.filter(m => isParentRole(m.role)).map(member => (
            <Card key={member.id}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Avatar src={member.avatarUrl} fallback={member.displayName[0]} />
                  <div>
                    <h4 className="font-semibold text-gray-900 flex items-center gap-2">
                      {member.displayName}
                      {getRoleLabel(member.role) && (
                        <Badge variant="default" className="text-[10px]">{getRoleLabel(member.role)}</Badge>
                      )}
                    </h4>
                  </div>
                </div>
                {isParentRole(currentUser?.role) && (
                  <Button variant="ghost" size="sm" onClick={() => setEditingMember(member)} className="text-gray-500 hover:text-gray-700">
                    {t('edit')}
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          {activeTab === 'current' ? <Trophy size={20} className="text-reward-500" /> : <History size={20} className="text-gray-400" />}
          {t('childrenRankings')}
        </h3>
        <div className="flex bg-gray-100 p-1 rounded-lg">
          <button 
            onClick={() => setActiveTab('current')}
            className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${activeTab === 'current' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
          >
            {t('thisWeek')}
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${activeTab === 'history' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
          >
            {t('history')}
          </button>
        </div>
      </div>

      {activeTab === 'current' ? (
        <div className="space-y-4">
          {sortedMembers.map((member, idx) => {
            const isChampion = champion && champion.id === member.id;
            
            return (
              <Link key={member.id} to={`/family/${member.id}`} className="block">
                <Card className={`hover:border-primary-300 transition-all active:scale-[0.98] ${isChampion ? 'border-reward-400 shadow-md ring-1 ring-reward-400' : ''}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="font-bold text-gray-400 w-4 text-center">{idx + 1}</div>
                        <Avatar src={member.avatarUrl} fallback={member.displayName[0]} />
                        <div>
                          <h4 className="font-semibold text-gray-900 flex items-center gap-2">
                            {member.displayName}
                            {!isChildRole(member.role) && getRoleLabel(member.role) && (
                              <Badge variant="default" className="text-[10px]">{getRoleLabel(member.role)}</Badge>
                            )}
                            {isChildRole(member.role) && member.isManaged && (
                              <Badge variant="outline" className="text-[10px] border-gray-300 text-gray-500 bg-gray-50">{t('managed')}</Badge>
                            )}
                          </h4>
                          <p className="text-sm text-gray-500 font-medium mt-0.5">{t('ptsThisWeek', { value: formatNumber(member.weeklyXP) })}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {isChampion && <Crown size={20} className="text-reward-500 fill-reward-500" />}
                        <ChevronRight size={20} className="text-gray-300" />
                        {isParentRole(currentUser?.role) && (
                          <Button variant="ghost" size="sm" onClick={(e) => { e.preventDefault(); setEditingMember(member); }} className="text-gray-500 hover:text-gray-700 ml-2 relative z-20">
                            Edit
                          </Button>
                        )}
                      </div>
                    </div>
                    {isChildRole(member.role) && member.isManaged && (
                      <ChildLoginSection member={member} onRequestCreate={(m) => setCreateLoginFor(m)} />
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500 shadow-sm mt-4">
          <Trophy size={48} className="mx-auto text-gray-300 mb-4" />
          <h4 className="text-lg font-bold text-gray-900 mb-1">{t('noPastChampions.title')}</h4>
          <p className="text-sm">{t('noPastChampions.subtitle')}</p>
        </div>
      )}

      {/* Create Challenge Modal */}
      {isChallengeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-gray-900/40 backdrop-blur-sm">
          <div className="bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-xl overflow-hidden flex flex-col">
            <div className="px-6 py-4 flex justify-between items-center border-b border-gray-100">
              <h3 className="text-xl font-bold text-gray-900">{t('newChallenge.title')}</h3>
              <button onClick={() => setIsChallengeModalOpen(false)} className="p-2 -mr-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-500">✕</button>
            </div>
            <div className="p-6">
              <form onSubmit={handleCreateChallenge} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">{t('newChallenge.challengeTitle')}</label>
                  <input type="text" required value={challengeData.title} onChange={e => setChallengeData({...challengeData, title: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">{t('newChallenge.xpTarget')}</label>
                  <input type="number" required min="10" value={challengeData.targetXP} onChange={e => setChallengeData({...challengeData, targetXP: Number(e.target.value)})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
                  <p className="text-xs text-gray-500 mt-1">{t('newChallenge.xpTargetHelp')}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">{t('newChallenge.rewardPerChild')}</label>
                  <input type="number" required min="1" value={challengeData.rewardPoints} onChange={e => setChallengeData({...challengeData, rewardPoints: Number(e.target.value)})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
                  <p className="text-xs text-gray-500 mt-1">{t('newChallenge.rewardPerChildHelp')}</p>
                </div>
                <div className="pt-4">
                  <Button type="submit" fullWidth disabled={isSubmitting} className="bg-primary-500">
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
      {isAddChildOpen && (
        <AddChildModal
          familyId={currentUser.familyId}
          onClose={() => setIsAddChildOpen(false)}
          onChildAdded={() => {
            showToast(t('childAdded'));
          }}
        />
      )}

      {/* Toast / snackbar */}
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
