import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Plus, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import { useStore } from '../store/useStore';
import { completeTask } from '../lib/api';

export function Tasks() {
  const { tasks, taskCompletions, currentUser, loading } = useStore();
  const [filter, setFilter] = useState<'all' | 'daily' | 'weekly' | 'one-time'>('all');
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [isCompleting, setIsCompleting] = useState(false);

  if (loading) return <div className="p-8 text-center text-gray-500 animate-pulse">Loading Tasks...</div>;

  // Map completions back to tasks to know their status for the current user
  const mappedTasks = tasks.map(task => {
    const completion = taskCompletions.find(c => c.taskId === task.id && c.assigneeId === currentUser?.id);
    return {
      ...task,
      status: completion ? completion.status : 'pending',
      completionId: completion?.id
    };
  });

  const filteredTasks = filter === 'all' ? mappedTasks : mappedTasks.filter(t => t.type === filter);

  const handleTaskClick = (task: any) => {
    setSelectedTask(task);
    setIsCompleting(false);
  };

  const handleComplete = async () => {
    if (!currentUser) return;
    setIsCompleting(true);
    
    try {
      await completeTask(currentUser.familyId, selectedTask.id, currentUser.id, selectedTask.requiresApproval);
      setTimeout(() => {
        setSelectedTask(null);
        setIsCompleting(false);
      }, 1500);
    } catch (e) {
      console.error(e);
      setIsCompleting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Tasks</h1>
          <p className="text-gray-500 mt-1">Stay on track today.</p>
        </div>
        <Button size="icon" className="rounded-full shadow-lg hover:shadow-xl active:scale-95 transition-all">
          <Plus size={24} />
        </Button>
      </header>

      <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 hide-scrollbar">
        {['all', 'daily', 'weekly', 'one-time'].map((f) => (
          <Button 
            key={f} 
            variant={filter === f ? 'primary' : 'secondary'} 
            size="sm"
            onClick={() => setFilter(f as any)}
            className="capitalize rounded-full whitespace-nowrap px-5"
          >
            {f.replace('-', ' ')}
          </Button>
        ))}
      </div>

      <div className="space-y-3">
        {filteredTasks.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500">
            No tasks found.
          </div>
        ) : filteredTasks.map((task) => (
          <div 
            key={task.id} 
            onClick={() => handleTaskClick(task)}
            className={`bg-white p-4 rounded-2xl border flex items-center justify-between shadow-sm transition-all cursor-pointer hover:border-primary-300 active:scale-[0.98] ${
              task.status === 'approved' ? 'opacity-60 border-gray-100 bg-gray-50' : 
              task.status === 'pending_approval' ? 'border-warning-200 bg-warning-50/30' : 'border-gray-200'
            }`}
          >
            <div className="flex items-start gap-4">
              <div 
                className={`w-6 h-6 mt-0.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  task.status === 'approved' ? 'bg-success-500 border-success-500 text-white' : 
                  task.status === 'pending_approval' ? 'border-warning-500 text-warning-500' : 'border-gray-300'
                }`}
              >
                {task.status === 'approved' && <CheckCircle2 size={16} strokeWidth={3} />}
                {task.status === 'pending_approval' && <Clock size={14} strokeWidth={3} />}
              </div>
              <div>
                <h4 className={`font-semibold text-base ${task.status === 'approved' ? 'line-through text-gray-500' : 'text-gray-900'}`}>{task.title}</h4>
                
                {task.status === 'pending_approval' && (
                  <p className="text-xs text-warning-600 font-medium mt-1 flex items-center gap-1">
                    <AlertCircle size={12} /> Waiting for parent approval
                  </p>
                )}

                <div className="flex flex-wrap gap-2 mt-2">
                  {task.pointsReward > 0 && <Badge variant="primary" className="text-[10px] py-1 px-2">+{task.pointsReward} pts</Badge>}
                  <Badge variant="default" className="text-[10px] py-1 px-2 capitalize bg-gray-100 text-gray-500">{task.type.replace('-', ' ')}</Badge>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Modal isOpen={!!selectedTask} onClose={() => setSelectedTask(null)} title="Task Details">
        {selectedTask && (
          <div className="space-y-6">
            {!isCompleting ? (
              <>
                <div>
                  <h3 className="text-xl font-bold text-gray-900">{selectedTask.title}</h3>
                  <p className="text-gray-500 mt-2 text-sm leading-relaxed">{selectedTask.description}</p>
                </div>
                
                <div className="bg-gray-50 rounded-2xl p-4 flex gap-4 divide-x divide-gray-200">
                  {selectedTask.pointsReward > 0 && (
                    <div className="flex-1">
                      <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">Points</p>
                      <p className="text-xl font-bold text-primary-600">+{selectedTask.pointsReward}</p>
                    </div>
                  )}
                </div>

                {selectedTask.status === 'pending' && (
                  <Button fullWidth onClick={handleComplete} size="lg" className="shadow-primary-500/25">
                    Mark as Done
                  </Button>
                )}
                
                {selectedTask.status === 'pending_approval' && (
                  <div className="bg-warning-50 text-warning-700 p-4 rounded-xl flex items-start gap-3">
                    <Clock size={20} className="shrink-0 mt-0.5" />
                    <p className="text-sm font-medium">You marked this as done. It's waiting for a parent to approve it.</p>
                  </div>
                )}
                
                {selectedTask.status === 'approved' && (
                  <div className="bg-success-50 text-success-700 p-4 rounded-xl flex items-start gap-3">
                    <CheckCircle2 size={20} className="shrink-0 mt-0.5" />
                    <p className="text-sm font-medium">This task is completed and approved!</p>
                  </div>
                )}
              </>
            ) : (
              <div className="py-8 flex flex-col items-center text-center animate-in zoom-in duration-300">
                <div className="w-20 h-20 bg-success-100 rounded-full flex items-center justify-center mb-4 text-success-500">
                  <CheckCircle2 size={48} />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">Great Job!</h3>
                <p className="text-gray-500 text-sm">
                  {selectedTask.requiresApproval 
                    ? "Task sent for approval. Points will be added soon!" 
                    : "Points have been added to your balance."}
                </p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
