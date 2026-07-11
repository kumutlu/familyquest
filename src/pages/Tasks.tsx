import { useState } from 'react';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { CheckCircle2, Plus, Edit, Trash2 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { completeTask, createTask, updateTask } from '../lib/api';
import { cn } from '../lib/utils';

export function Tasks() {
  const { currentUser, tasks, taskCompletions, loading } = useStore();
  const [filter, setFilter] = useState<'all' | 'daily' | 'weekly' | 'one-time'>('all');
  const [selectedTask, setSelectedTask] = useState<any>(null);
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formData, setFormData] = useState<any>({ title: '', pointsReward: 10, type: 'daily', requiresApproval: true });
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (loading) return <div className="p-8 text-center text-gray-500 animate-pulse">Loading Tasks...</div>;

  // Filter out archived tasks first
  const activeTasks = tasks.filter(t => t.isActive !== false);

  // Map completions back to tasks to know their status for the current user
  const mappedTasks = activeTasks.map(task => {
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
    setIsSubmitting(false);
    setError(null);
  };

  const handleComplete = async () => {
    if (!currentUser) return;
    setIsSubmitting(true);
    setError(null);
    
    try {
      await completeTask(currentUser.familyId, selectedTask.id, currentUser.id, selectedTask.requiresApproval);
      setTimeout(() => {
        setSelectedTask(null);
        setIsSubmitting(false);
      }, 1500);
    } catch (e: any) {
      console.error(e);
      setError(e.message || 'Failed to complete task.');
      setIsSubmitting(false);
    }
  };

  const openCreateForm = () => {
    setFormData({ title: '', pointsReward: 10, type: 'daily', requiresApproval: true });
    setIsFormOpen(true);
  };

  const openEditForm = (task: any) => {
    setFormData({ ...task });
    setSelectedTask(null);
    setIsFormOpen(true);
  };

  const handleArchive = async (taskId: string) => {
    if (!currentUser) return;
    if (confirm('Are you sure you want to archive this task?')) {
      try {
        await updateTask(currentUser.familyId, taskId, { isActive: false });
        setSelectedTask(null);
      } catch (e: any) {
        alert(e.message);
      }
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    setIsSubmitting(true);
    try {
      if (formData.id) {
        await updateTask(currentUser.familyId, formData.id, {
          title: formData.title,
          pointsReward: Number(formData.pointsReward),
          type: formData.type,
          requiresApproval: formData.requiresApproval
        });
        setSuccessMsg('Task updated successfully!');
      } else {
        await createTask(currentUser.familyId, {
          title: formData.title,
          pointsReward: Number(formData.pointsReward),
          type: formData.type,
          requiresApproval: formData.requiresApproval
        });
        setSuccessMsg('Task created successfully!');
      }
      setIsFormOpen(false);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (e: any) {
      setError(e.message);
    }
    setIsSubmitting(false);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Tasks</h1>
          <p className="text-gray-500 mt-1">Earn points by completing your tasks.</p>
        </div>
        {currentUser?.role === 'parent' && (
          <Button onClick={openCreateForm} size="sm" className="bg-primary-500 rounded-full h-10 w-10 p-0 shadow-lg flex items-center justify-center">
            <Plus size={20} />
          </Button>
        )}
      </header>

      {successMsg && (
        <div className="bg-success-50 text-success-700 p-3 rounded-xl mb-4 text-sm font-medium animate-in fade-in slide-in-from-top-2">
          {successMsg}
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
        <Button variant={filter === 'all' ? 'primary' : 'secondary'} size="sm" onClick={() => setFilter('all')} className="rounded-full">All Tasks</Button>
        <Button variant={filter === 'daily' ? 'primary' : 'secondary'} size="sm" onClick={() => setFilter('daily')} className="rounded-full">Daily</Button>
        <Button variant={filter === 'weekly' ? 'primary' : 'secondary'} size="sm" onClick={() => setFilter('weekly')} className="rounded-full">Weekly</Button>
        <Button variant={filter === 'one-time' ? 'primary' : 'secondary'} size="sm" onClick={() => setFilter('one-time')} className="rounded-full whitespace-nowrap">One Time</Button>
      </div>

      <div className="space-y-3 pb-24">
        {filteredTasks.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500">
            No active tasks found in this category.
          </div>
        ) : (
          filteredTasks.map((task) => (
            <Card key={task.id} className={cn(
              "cursor-pointer transition-all active:scale-[0.98]",
              task.status === 'approved' ? 'opacity-50' : 'hover:border-primary-300'
            )} onClick={() => handleTaskClick(task)}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className={cn(
                  "w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                  task.status === 'approved' ? "bg-success-500 border-success-500 text-white" : 
                  task.status === 'pending_approval' ? "bg-warning-500 border-warning-500 text-white" :
                  "border-gray-300 text-transparent"
                )}>
                  <CheckCircle2 size={16} className={task.status !== 'pending' ? 'opacity-100' : 'opacity-0'} />
                </div>
                
                <div className="flex-1 min-w-0">
                  <h3 className={cn("font-bold truncate", task.status === 'approved' ? 'text-gray-500 line-through' : 'text-gray-900')}>
                    {task.title}
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant={task.status === 'approved' ? 'default' : 'primary'}>
                      +{task.pointsReward} pts
                    </Badge>
                    {task.status === 'pending_approval' && (
                      <Badge variant="warning" className="bg-warning-100 text-warning-700">Waiting for Approval</Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Task Details Modal */}
      {selectedTask && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-xl animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-10 duration-300 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 flex justify-between items-center border-b border-gray-100 shrink-0 bg-white sticky top-0">
              <h3 className="text-xl font-bold text-gray-900">Task Details</h3>
              <button onClick={() => setSelectedTask(null)} className="p-2 -mr-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-500 transition-colors">
                ✕
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-20 h-20 bg-primary-100 rounded-full flex items-center justify-center text-primary-500">
                  <CheckCircle2 size={40} />
                </div>
                
                <div>
                  <h4 className="text-2xl font-bold text-gray-900">{selectedTask.title}</h4>
                  <p className="text-gray-500 font-medium mt-1">Reward: {selectedTask.pointsReward} points</p>
                </div>

                <div className="flex gap-2">
                  <Badge variant="default">{selectedTask.type}</Badge>
                  {selectedTask.requiresApproval && <Badge variant="warning">Requires Approval</Badge>}
                </div>
                
                {error && <p className="text-danger-500 text-sm font-medium">{error}</p>}

                {/* Parent Actions */}
                {currentUser?.role === 'parent' && (
                   <div className="flex gap-4 w-full mt-6 pt-6 border-t border-gray-100">
                      <Button variant="secondary" fullWidth onClick={() => openEditForm(selectedTask)}><Edit size={16} className="mr-2"/> Edit</Button>
                      <Button variant="danger" fullWidth onClick={() => handleArchive(selectedTask.id)}><Trash2 size={16} className="mr-2"/> Archive</Button>
                   </div>
                )}

                {/* Child Actions */}
                {currentUser?.role === 'child' && selectedTask.status === 'pending' && (
                  <Button fullWidth onClick={handleComplete} size="lg" disabled={isSubmitting} className="shadow-primary-500/25 mt-6">
                    {isSubmitting ? 'Submitting...' : 'Mark as Done'}
                  </Button>
                )}
                {currentUser?.role === 'child' && selectedTask.status !== 'pending' && (
                  <div className="mt-6 p-4 bg-gray-50 rounded-xl w-full">
                    <p className="text-gray-500 font-medium">
                      {selectedTask.status === 'approved' ? 'Task completed and approved!' : 'Waiting for parent approval.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Form Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-xl overflow-hidden flex flex-col max-h-[90vh] animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-10 duration-300">
            <div className="px-6 py-4 flex justify-between items-center border-b border-gray-100">
              <h3 className="text-xl font-bold text-gray-900">{formData.id ? 'Edit Task' : 'New Task'}</h3>
              <button onClick={() => setIsFormOpen(false)} className="p-2 -mr-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-500">✕</button>
            </div>
            <div className="p-6 overflow-y-auto">
              <form onSubmit={handleFormSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Task Title</label>
                  <input type="text" required value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Points Reward</label>
                  <input type="number" required min="1" value={formData.pointsReward} onChange={e => setFormData({...formData, pointsReward: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Category</label>
                  <select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md bg-white">
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="one-time">One-Time</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <input type="checkbox" id="approval" checked={formData.requiresApproval} onChange={e => setFormData({...formData, requiresApproval: e.target.checked})} className="w-4 h-4 text-primary-600 rounded border-gray-300 focus:ring-primary-500" />
                  <label htmlFor="approval" className="text-sm font-medium text-gray-700">Requires Parent Approval</label>
                </div>
                {error && <p className="text-red-500 text-sm">{error}</p>}
                <div className="pt-4">
                  <Button type="submit" fullWidth disabled={isSubmitting}>
                    {isSubmitting ? 'Saving...' : 'Save Task'}
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
