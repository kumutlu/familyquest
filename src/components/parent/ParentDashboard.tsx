import { useStore } from '../../store/useStore';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { approveTaskCompletion, rejectTaskCompletion, addBehaviourEvent } from '../../lib/api';
import { Clock, Plus, Zap, Gift, Users, MessageSquare } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

export function ParentDashboard() {
  const { currentUser, taskCompletions, tasks, feed, familyMembers } = useStore();
  
  const [selectedCompletion, setSelectedCompletion] = useState<any>(null);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending');

  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [eventData, setEventData] = useState({ childId: '', title: '', pointsDelta: 0 });

  const pendingApprovals = taskCompletions.filter(c => c.status === 'pending_approval');
  const historyApprovals = taskCompletions.filter(c => c.status === 'approved' || c.status === 'rejected')
    .sort((a, b) => (b.approvedAt?.toMillis() || b.rejectedAt?.toMillis() || 0) - (a.approvedAt?.toMillis() || a.rejectedAt?.toMillis() || 0))
    .slice(0, 10);
    
  const children = familyMembers.filter(m => m.role === 'child');

  const handleAction = async (action: 'approve' | 'reject') => {
    if (!currentUser || !selectedCompletion) return;
    setIsSubmitting(true);
    try {
      if (action === 'approve') {
        await approveTaskCompletion(currentUser.familyId, selectedCompletion.id, selectedCompletion.taskId, selectedCompletion.assigneeId, comment);
      } else {
        await rejectTaskCompletion(currentUser.familyId, selectedCompletion.id, selectedCompletion.taskId, selectedCompletion.assigneeId, comment || 'Please try again.');
      }
      setSelectedCompletion(null);
      setComment('');
    } catch (e) {
      console.error(e);
    }
    setIsSubmitting(false);
  };

  const openReviewModal = (completion: any) => {
    setSelectedCompletion(completion);
    setComment('');
  };

  const handleLogEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !eventData.childId) return;
    setIsSubmitting(true);
    try {
      await addBehaviourEvent(currentUser.familyId, eventData.childId, currentUser.id, eventData.title, Number(eventData.pointsDelta));
      setIsEventModalOpen(false);
      setEventData({ childId: '', title: '', pointsDelta: 0 });
    } catch (err) {
      console.error(err);
    }
    setIsSubmitting(false);
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
          <button onClick={() => setIsEventModalOpen(true)} className="bg-warning-50 hover:bg-warning-100 transition-colors rounded-xl p-3 flex flex-col items-center justify-center text-center text-warning-700">
            <Zap size={20} className="mb-1" />
            <span className="text-xs font-bold">Log Event</span>
          </button>
        </div>
      </section>

      {/* Approval Center */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Clock size={20} className="text-warning-500" />
            Approval Center
          </h2>
          <div className="flex bg-gray-100 p-1 rounded-lg">
            <button 
              onClick={() => setActiveTab('pending')}
              className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${activeTab === 'pending' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
            >
              Pending ({pendingApprovals.length})
            </button>
            <button 
              onClick={() => setActiveTab('history')}
              className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${activeTab === 'history' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
            >
              History
            </button>
          </div>
        </div>
        
        {activeTab === 'pending' ? (
          pendingApprovals.length === 0 ? (
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
                        <Button size="sm" onClick={() => openReviewModal(completion)} className="bg-white text-gray-900 border border-gray-200 hover:bg-gray-50 h-8 px-4">
                          Review
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )
        ) : (
          historyApprovals.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500 shadow-sm">
              No approval history yet.
            </div>
          ) : (
            <div className="space-y-3">
              {historyApprovals.map(completion => {
                const task = tasks.find(t => t.id === completion.taskId);
                const child = children.find(c => c.id === completion.assigneeId);
                if (!task || !child) return null;
                
                return (
                  <Card key={completion.id} className="opacity-75">
                    <CardContent className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Avatar src={child.avatarUrl} fallback={child.displayName[0]} size="sm" />
                        <div>
                          <h4 className="font-semibold text-gray-900">{task.title}</h4>
                          <p className="text-xs text-gray-500 font-medium">
                            {completion.status === 'approved' ? 'Approved' : 'Rejected'} for {child.displayName}
                          </p>
                          {completion.parentComment && (
                            <p className="text-xs text-gray-600 mt-1 italic">"{completion.parentComment}"</p>
                          )}
                        </div>
                      </div>
                      <Badge variant={completion.status === 'approved' ? 'success' : 'danger'}>
                        {completion.status}
                      </Badge>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )
        )}
      </section>

      {/* Review Modal */}
      {selectedCompletion && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-gray-900/40 backdrop-blur-sm">
          <div className="bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-xl overflow-hidden flex flex-col">
            <div className="px-6 py-4 flex justify-between items-center border-b border-gray-100">
              <h3 className="text-xl font-bold text-gray-900">Review Task</h3>
              <button onClick={() => setSelectedCompletion(null)} className="p-2 -mr-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-500">✕</button>
            </div>
            
            <div className="p-6">
              <div className="mb-6">
                <h4 className="text-lg font-bold text-gray-900">{tasks.find(t => t.id === selectedCompletion.taskId)?.title}</h4>
                <p className="text-sm text-gray-500">Completed by {children.find(c => c.id === selectedCompletion.assigneeId)?.displayName}</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                    <MessageSquare size={14} /> Add Comment (Optional)
                  </label>
                  <textarea 
                    value={comment}
                    onChange={e => setComment(e.target.value)}
                    placeholder="Great job! / Please try again..."
                    rows={3}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <Button variant="danger" fullWidth onClick={() => handleAction('reject')} disabled={isSubmitting}>
                    Reject
                  </Button>
                  <Button variant="primary" fullWidth onClick={() => handleAction('approve')} disabled={isSubmitting}>
                    Approve
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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

      {/* Log Behaviour Event Modal */}
      {isEventModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-gray-900/40 backdrop-blur-sm">
          <div className="bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 flex justify-between items-center border-b border-gray-100">
              <h3 className="text-xl font-bold text-gray-900">Log Behaviour</h3>
              <button onClick={() => setIsEventModalOpen(false)} className="p-2 -mr-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-500">✕</button>
            </div>
            <div className="p-6 overflow-y-auto">
              <form onSubmit={handleLogEvent} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Child</label>
                  <select required value={eventData.childId} onChange={e => setEventData({...eventData, childId: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md bg-white">
                    <option value="" disabled>Select a child</option>
                    {children.map(c => (
                      <option key={c.id} value={c.id}>{c.displayName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Reason / Notes</label>
                  <input type="text" required placeholder="e.g. Helped with groceries" value={eventData.title} onChange={e => setEventData({...eventData, title: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Points Adjustment (+ or -)</label>
                  <input type="number" required value={eventData.pointsDelta} onChange={e => setEventData({...eventData, pointsDelta: Number(e.target.value)})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
                  <p className="text-xs text-gray-500 mt-1">Use negative numbers to deduct points.</p>
                </div>
                
                <div className="pt-4">
                  <Button type="submit" fullWidth disabled={isSubmitting} className={eventData.pointsDelta >= 0 ? "bg-success-500 hover:bg-success-600" : "bg-danger-500 hover:bg-danger-600"}>
                    {isSubmitting ? 'Saving...' : 'Log Event'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
