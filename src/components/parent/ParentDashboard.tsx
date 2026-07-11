import { useStore } from '../../store/useStore';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { approveTaskCompletion } from '../../lib/api';
import { Clock } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../ui/Button';

export function ParentDashboard() {
  const { currentUser, taskCompletions, tasks, feed } = useStore();
  const [approving, setApproving] = useState<string | null>(null);

  const pendingApprovals = taskCompletions.filter(c => c.status === 'pending_approval');

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
    <div className="space-y-8 animate-in fade-in duration-300">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Parent Console</h1>
        <p className="text-gray-500 mt-1">Manage your family's progress.</p>
      </header>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <Clock size={20} className="text-warning-500" />
          Pending Approvals
        </h2>
        
        {pendingApprovals.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500">
            No pending approvals.
          </div>
        ) : (
          <div className="space-y-3">
            {pendingApprovals.map(completion => {
              const task = tasks.find(t => t.id === completion.taskId);
              if (!task) return null;
              
              return (
                <Card key={completion.id}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <h4 className="font-semibold text-gray-900">{task.title}</h4>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="primary" className="text-[10px]">+{task.pointsReward} pts</Badge>
                      </div>
                    </div>
                    <Button 
                      size="sm" 
                      onClick={() => handleApprove(completion)}
                      disabled={approving === completion.id}
                      className="bg-success-500 hover:bg-success-600"
                    >
                      {approving === completion.id ? 'Approving...' : 'Approve'}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-4">Family Activity</h2>
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
      </section>
    </div>
  );
}
