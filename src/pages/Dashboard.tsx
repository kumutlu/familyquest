import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Stat } from '../components/ui/Stat';
import { Progress } from '../components/ui/Progress';
import { Flame, Star, MessageCircle, Inbox } from 'lucide-react';
import { useStore } from '../store/useStore';
import { isParentRole } from '../lib/roles';
import { ParentDashboard } from '../components/parent/ParentDashboard';
import { RequestCard } from '../components/requests/RequestCard';
import { useRequestDetail } from '../components/requests/RequestDetailContext';
import { normalizeRequest, type RequestContext, type RequestCategory } from '../lib/requestModel';
import { resolveFeedRequest } from '../lib/feedRequestResolver';

export function Dashboard() {
  const {
    currentUser,
    feed,
    loading,
    familyMembers,
    familyData,
    tasks,
    rewards,
    moneyRequests,
    transferRequests,
    petboxRequests,
    profileUpdateRequests,
    taskCompletions,
    redemptions,
  } = useStore();
  const { openRequest } = useRequestDetail();

  if (loading || !currentUser) return <div className="p-8 text-center text-gray-500 animate-pulse">Loading Dashboard...</div>;

  if (isParentRole(currentUser.role)) {
    return <ParentDashboard />;
  }

  const currentLevel = Math.floor((currentUser.lifetimeXP || 0) / 1000) + 1; // Simplified formula
  const xpInLevel = (currentUser.lifetimeXP || 0) % 1000;
  const levelProgress = (xpInLevel / 1000) * 100;

  const ctx: RequestContext = {
    currency: familyData?.currency || '£',
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
    ...(petboxRequests || []).map(r => ({ ...r, category: 'petbox' as RequestCategory })),
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
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Good Morning, {currentUser.displayName}! ☀️</h1>
        <p className="mt-1 text-gray-500">You're doing great this week.</p>
      </header>

      <div className="grid grid-cols-2 gap-4">
        <Stat label="Total Points" value={currentUser.rewardPoints || 0} icon={<Star className="fill-current" />} />
        <Stat label="Day Streak" value={currentUser.currentStreak || 0} icon={<Flame className="text-warning-500 fill-warning-500" />} />
      </div>

      <div className="grid grid-cols-1 gap-4">
        <Card className="border-none bg-primary-500 text-white">
          <CardHeader className="border-none pb-2">
            <CardTitle className="flex justify-between text-sm font-medium uppercase tracking-wider text-white opacity-90">
              Level {currentLevel}
              <span>{Math.round(levelProgress)}%</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={levelProgress} className="bg-primary-700 [&>div]:bg-white" />
            <p className="mt-3 text-right text-xs font-medium text-primary-200">{1000 - xpInLevel} XP to Level {currentLevel + 1}</p>
          </CardContent>
        </Card>
      </div>

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
          Recent Activity
        </h2>
        {feed.length === 0 ? (
          <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center text-gray-500">
            No recent activity.
          </div>
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
                      <span className="mt-1 text-xs text-gray-400">{date.toLocaleString()}</span>
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
