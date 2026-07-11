import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Plus, Clock, CheckCircle2, AlertCircle } from 'lucide-react';

export function Tasks() {
  const [filter, setFilter] = useState<'all' | 'daily' | 'weekly' | 'one-time'>('all');
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [isCompleting, setIsCompleting] = useState(false);

  const tasks = [
    { id: 1, title: 'Clean your room', description: 'Put all toys away and make the bed.', type: 'daily', points: 50, money: 0, status: 'pending', requiresApproval: true },
    { id: 2, title: 'Walk the dog', description: 'Take Buster for a 15 min walk.', type: 'daily', points: 20, money: 0.50, status: 'completed', requiresApproval: false },
    { id: 3, title: 'Do laundry', description: 'Fold clothes and put them in drawers.', type: 'weekly', points: 150, money: 0, status: 'pending_approval', requiresApproval: true },
    { id: 4, title: 'Help wash the car', description: 'Wash and dry the family car.', type: 'one-time', points: 300, money: 5.00, status: 'pending', requiresApproval: true },
  ];

  const filteredTasks = filter === 'all' ? tasks : tasks.filter(t => t.type === filter);

  const handleTaskClick = (task: any) => {
    setSelectedTask(task);
    setIsCompleting(false);
  };

  const handleComplete = () => {
    setIsCompleting(true);
    setTimeout(() => {
      setSelectedTask(null);
      setIsCompleting(false);
    }, 1500);
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
        {filteredTasks.map((task) => (
          <div 
            key={task.id} 
            onClick={() => handleTaskClick(task)}
            className={`bg-white p-4 rounded-2xl border flex items-center justify-between shadow-sm transition-all cursor-pointer hover:border-primary-300 active:scale-[0.98] ${
              task.status === 'completed' ? 'opacity-60 border-gray-100 bg-gray-50' : 
              task.status === 'pending_approval' ? 'border-warning-200 bg-warning-50/30' : 'border-gray-200'
            }`}
          >
            <div className="flex items-start gap-4">
              <div 
                className={`w-6 h-6 mt-0.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  task.status === 'completed' ? 'bg-success-500 border-success-500 text-white' : 
                  task.status === 'pending_approval' ? 'border-warning-500 text-warning-500' : 'border-gray-300'
                }`}
              >
                {task.status === 'completed' && <CheckCircle2 size={16} strokeWidth={3} />}
                {task.status === 'pending_approval' && <Clock size={14} strokeWidth={3} />}
              </div>
              <div>
                <h4 className={`font-semibold text-base ${task.status === 'completed' ? 'line-through text-gray-500' : 'text-gray-900'}`}>{task.title}</h4>
                
                {task.status === 'pending_approval' && (
                  <p className="text-xs text-warning-600 font-medium mt-1 flex items-center gap-1">
                    <AlertCircle size={12} /> Waiting for parent approval
                  </p>
                )}

                <div className="flex flex-wrap gap-2 mt-2">
                  {task.points > 0 && <Badge variant="primary" className="text-[10px] py-1 px-2">+{task.points} pts</Badge>}
                  {task.money > 0 && <Badge variant="success" className="text-[10px] py-1 px-2">+${task.money.toFixed(2)}</Badge>}
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
                  {selectedTask.points > 0 && (
                    <div className="flex-1">
                      <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">Points</p>
                      <p className="text-xl font-bold text-primary-600">+{selectedTask.points}</p>
                    </div>
                  )}
                  {selectedTask.money > 0 && (
                    <div className="flex-1 pl-4">
                      <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wider">Money</p>
                      <p className="text-xl font-bold text-success-600">+${selectedTask.money.toFixed(2)}</p>
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
