import { Flame, Star, MessageCircle, Inbox } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { HelpButton } from '../help/components/HelpButton';
import { PageLoader } from '../components/ui/PageLoader';
import { EmptyState } from '../components/ui/EmptyState';
import { useStore } from '../store/useStore';
import { isParentRole } from '../lib/roles';
import { ParentDashboard } from '../components/parent/ParentDashboard';
import { RequestCard } from '../components/requests/RequestCard';
import { useRequestDetail } from '../components/requests/RequestDetailContext';
import { normalizeRequest, type RequestContext, type RequestCategory } from '../lib/requestModel';
import { resolveFeedRequest } from '../lib/feedRequestResolver';
import { formatDate } from '../i18n/format';
import { WalletSummaryCard } from '../components/dashboard/WalletSummaryCard';
import { GoalSummaryCard } from '../components/dashboard/GoalSummaryCard';
import { PetBoxSummaryCard } from '../components/dashboard/PetBoxSummaryCard';
import { TaskSummaryCard } from '../components/dashboard/TaskSummaryCard';
import { GamificationSummaryCard } from '../components/dashboard/GamificationSummaryCard';
import { adaptGamificationSummary } from '../lib/gamificationAdapters';
import { isPetBoxEnabled } from '../lib/familyFeatures';
import { FamilyBulletin } from '../components/bulletin/FamilyBulletin';
import { DailyCheckinExperience } from '../components/checkins/DailyCheckinExperience';

export function Dashboard() {
  const { t } = useTranslation('dashboard');
  const { currentUser, loading } = useStore();

  if (loading || !currentUser) return <PageLoader label={t('loading')} />;

  return (
    <DailyCheckinExperience>
      {isParentRole(currentUser.role) ? <ParentDashboard /> : <ChildDashboardContent />}
    </DailyCheckinExperience>
  );
}

function ChildDashboardContent() {
  const { t } = useTranslation('dashboard');
  const {
    currentUser,
    feed,
    loading,
    familyMembers,
    tasks,
    rewards,
    moneyRequests,
    transferRequests,
    petboxRequests,
    profileUpdateRequests,
    taskCompletions,
    redemptions,
    myGamificationSummary,
    myDailyProgress,
    familyData,
  } = useStore();
  const { openRequest } = useRequestDetail();

  if (!currentUser) return null;

  // Adapt gamification summary for child view
  const gamificationView = adaptGamificationSummary(myGamificationSummary, myDailyProgress);

  const ctx: RequestContext = {
    currency: '£',
    resolveMember: id => {
      const member = familyMembers.find(m => m.id === id);
      return member ? { id: member.id, name: member.displayName, avatarUrl: member.avatarUrl } : undefined;
    },
    resolveTask: id => {
      const task = tasks.find(t => t.id === id);
      return task ? { title: task.title, pointsReward: task.pointsReward } : undefined;
    },
    rewards: (rewards || []).reduce<Record<string, { title: string }>>((acc, reward) => {
      acc[reward.id] = { title: reward.title };
      return acc;
    }, {}),
  };

  const uid = currentUser.id;
  const isRelevant = (raw: any) =>
    raw.requesterId === uid ||
    raw.requestedFromId === uid ||
    raw.fromChildId === uid ||
    raw.toChildId === uid ||
    raw.childId === uid ||
    raw.assigneeId === uid ||
    raw.userId === uid;

  const rawRequests: any[] = [
    ...(moneyRequests || []).map(r => ({ ...r, category: 'money_request' as RequestCategory })),
    ...(transferRequests || []).map(r => ({ ...r, category: 'transfer' as RequestCategory })),
    ...(isPetBoxEnabled(familyData) ? (petboxRequests || []).map(r => ({ ...r, category: 'petbox' as RequestCategory })) : []),
    ...(profileUpdateRequests || []).map(r => ({ ...r, category: 'profile_update' as RequestCategory })),
    ...(taskCompletions || []).map(r => ({ ...r, category: 'task' as RequestCategory })),
    ...(redemptions || []).map(r => ({ ...r, category: 'reward' as RequestCategory })),
  ].filter(isRelevant);

  const sortedRequests = rawRequests
    .sort((a, b) => (normalizeRequest(a, ctx).createdAt ?? 0) - (normalizeRequest(b, ctx).createdAt ?? 0))
    .reverse()
    .slice(0, 6);

  const findRequestByEntity = (entityType?: string, entityId?: string): any | null =>
    resolveFeedRequest(
      { entityType, entityId },
      { moneyRequests, transferRequests, profileUpdateRequests, redemptions, taskCompletions, petboxRequests },
    );

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <header>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Good Morning, {currentUser.displayName}! ☀️</h1>
          <HelpButton />
        </div>
        <p className="mt-1 text-gray-500">You're doing great this week.</p>
      </header>

      <FamilyBulletin />

      <div className="grid grid-cols-2 gap-4">
        <div className="flex items-center justify-center gap-2 rounded-2xl bg-white p-4 shadow-sm border border-gray-100">
          <Star size={20} className="fill-current text-reward-500" />
          <span className="text-sm font-medium text-gray-500">Total Points</span>
          <span className="font-bold text-gray-900">{currentUser.rewardPoints || 0}</span>
        </div>
        <div className="flex items-center justify-center gap-2 rounded-2xl bg-white p-4 shadow-sm border border-gray-100">
          <Flame size={20} className="text-warning-500 fill-warning-500" />
          <span className="text-sm font-medium text-gray-500">Day Streak</span>
          <span className="font-bold text-gray-900">{currentUser.currentStreak || 0}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {/*
          `loading` is always false here (the page returns PageLoader above while
          bootstrap is in flight). Passing it explicitly documents that the card
          may only show a skeleton for an active request — a missing gamification
          projection renders the fallback UI instead.
        */}
        <GamificationSummaryCard summary={gamificationView} loading={loading} />
      </div>

      <section aria-label="Quick summaries">
        <div className="grid grid-cols-1 gap-4">
          <TaskSummaryCard />
          <WalletSummaryCard />
          <GoalSummaryCard />
          {isPetBoxEnabled(familyData) && <PetBoxSummaryCard />}
        </div>
      </section>

      {sortedRequests.length > 0 && (
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-gray-900">
            <Inbox size={20} className="text-gray-400" />
            Your Requests
          </h2>
          <div className="space-y-3">
            {sortedRequests.map(raw => (
              <RequestCard
                key={`${raw.category}-${raw.id}`}
                request={normalizeRequest(raw, ctx)}
                onOpen={() => openRequest(raw)}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-gray-900">
          <MessageCircle size={20} className="text-gray-400" />
          {t('recentActivity.dashboardHeading')}
        </h2>
        {feed.length === 0 ? (
          <EmptyState
            title={t('recentActivity.empty')}
            icon={<MessageCircle size={22} aria-hidden="true" />}
          />
        ) : (
          <div className="rounded-2xl border border-gray-100 bg-white p-1">
            {feed.slice(0, 8).map((item, idx) => {
              const date = item.timestamp?.toDate ? item.timestamp.toDate() : new Date();
              const linked = findRequestByEntity(item.entityType, item.entityId);
              const Wrapper = linked ? 'button' : 'div';
              return (
                <Wrapper
                  key={item.id}
                  {...(linked
                    ? { onClick: () => openRequest(linked), className: 'w-full text-left' }
                    : {})}
                >
                  <div className={`flex items-start gap-3 p-4 ${idx !== Math.min(feed.length, 8) - 1 ? 'border-b border-gray-50' : ''}`}>
                    <div className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary-400"></div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 break-words">{item.text}</p>
                      <span className="mt-1 text-xs text-gray-400">{formatDate(date)}</span>
                    </div>
                  </div>
                </Wrapper>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
