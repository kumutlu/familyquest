import { useStore } from '../../store/useStore';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { approveTaskCompletion } from '../../lib/api';
import { Clock, Plus, Zap, Gift, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

export function ParentDashboard() {
  const { currentUser, taskCompletions, tasks, feed, familyMembers } = useStore();
  const [approving, setApproving] = useState<string | null>(null);

  const pendingApprovals = taskCompletions.filter(c => c.status === 'pending_approval');
  const children = familyMembers.filter(m => m.role === 'child');

  const handleApprove = async (completion: any) => {
    if (!currentUser) return;
    setApproving(completion.id);
    try {
      await approveTaskCompletion(currentUser.familyId, completion.id, completion.taskId, completion.assigneeId);
    } catch (e) {
      console.error(e);
    }
    setApproving(null);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300 pb-8">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Parent Console</h1>
        <p className="text-gray-500 mt-1">Manage your family's progress.</p>
      </header>

      {/* Quick Actions */}
      <section>
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Quick Actions</h2>
        <div className="grid grid-cols-3 gap-3">
          <Link to="/tasks" className="bg-primary-50 hover:bg-primary-100 transition-colors rounded-xl p-3 flex flex-col items-center justify-center text-center text-primary-700">
            <Plus size={20} className="mb-1" />
            <span className="text-xs font-bold">New Task</span>
          </Link>
          <Link to="/rewards" className="bg-reward-50 hover:bg-reward-100 transition-colors rounded-xl p-3 flex flex-col items-center justify-center text-center text-reward-700">
            <Gift size={20} className="mb-1" />
            <span className="text-xs font-bold">New Reward</span>
          </Link>
          <button className="bg-warning-50 hover:bg-warning-100 transition-colors rounded-xl p-3 flex flex-col items-center justify-center text-center text-warning-700">
            <Zap size={20} className="mb-1" />
            <span className="text-xs font-bold">Log Event</span>
          </button>
        </div>
      </section>

      {/* Pending Approvals */}
      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <Clock size={20} className="text-warning-500" />
          Pending Approvals ({pendingApprovals.length})
        </h2>
        
        {pendingApprovals.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500 shadow-sm">
            You're all caught up!
          </div>
        ) : (
          <div className="space-y-3">
            {pendingApprovals.map(completion => {
              const task = tasks.find(t => t.id === completion.taskId);
              const child = children.find(c => c.id === completion.assigneeId);
              if (!task || !child) return null;
              
              return (
                <Card key={completion.id} className="border-warning-200 bg-warning-50/30">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Avatar src={child.avatarUrl} fallback={child.displayName[0]} size="sm" />
                      <div>
                        <h4 className="font-semibold text-gray-900">{task.title}</h4>
                        <p className="text-xs text-gray-500 font-medium">Completed by {child.displayName}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Badge variant="primary" className="text-[10px]">+{task.pointsReward} pts</Badge>
                      <Button 
                        size="sm" 
                        onClick={() => handleApprove(completion)}
                        disabled={approving === completion.id}
                        className="bg-success-500 hover:bg-success-600 shadow-success-500/25 h-8 px-4"
                      >
                        {approving === completion.id ? '...' : 'Approve'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Child Summaries */}
      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <Users size={20} className="text-primary-500" />
          Child Summaries
        </h2>
        <div className="space-y-3">
          {children.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500">
              No children in this family yet.
            </div>
          ) : (
            children.map(child => (
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
                    <div className="text-right">
                      <p className="text-sm font-bold text-primary-600">{child.rewardPoints || 0} pts</p>
                      <p className="text-xs text-success-600 font-bold mt-1">${((child.walletBalance || 0) / 100).toFixed(2)}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))
          )}
        </div>
      </section>

      {/* Family Activity */}
      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-4">Recent Activity</h2>
        {feed.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500">
            No recent activity.
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 p-1">
            {feed.slice(0, 5).map((item) => (
              <div key={item.id} className="p-4 flex items-start gap-3 border-b border-gray-50 last:border-0">
                <div className="w-2 h-2 rounded-full bg-primary-400 mt-2 shrink-0"></div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{item.text}</p>
                  <span className="text-xs text-gray-400 mt-1">
                    {item.timestamp?.toDate ? item.timestamp.toDate().toLocaleString() : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
