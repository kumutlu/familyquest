import React, { useState } from 'react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Plus } from 'lucide-react';

export function Tasks() {
  const [filter, setFilter] = useState<'all' | 'daily' | 'habits'>('all');

  const tasks = [
    { id: 1, title: 'Read for 30 minutes', type: 'daily', points: 50, money: 0, status: 'pending' },
    { id: 2, title: 'Walk the dog', type: 'daily', points: 20, money: 0.50, status: 'completed' },
    { id: 3, title: 'Drink water (8 glasses)', type: 'habits', points: 10, money: 0, status: 'pending' },
  ];

  return (
    <div className="space-y-6">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tasks</h1>
          <p className="text-gray-500">Stay on track today.</p>
        </div>
        <Button size="icon" className="rounded-full shadow-lg">
          <Plus size={24} />
        </Button>
      </header>

      <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 hide-scrollbar">
        {['all', 'daily', 'habits'].map((f) => (
          <Button 
            key={f} 
            variant={filter === f ? 'primary' : 'secondary'} 
            size="sm"
            onClick={() => setFilter(f as any)}
            className="capitalize rounded-full whitespace-nowrap"
          >
            {f}
          </Button>
        ))}
      </div>

      <div className="space-y-3">
        {tasks.map((task) => (
          <div key={task.id} className={`bg-white p-4 rounded-2xl border flex items-center justify-between shadow-sm transition-opacity ${task.status === 'completed' ? 'opacity-60 border-gray-100' : 'border-gray-200'}`}>
            <div className="flex items-center gap-4">
              <div 
                className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${task.status === 'completed' ? 'bg-success-500 border-success-500 text-white' : 'border-gray-300'}`}
              >
                {task.status === 'completed' && <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
              </div>
              <div>
                <h4 className={`font-semibold ${task.status === 'completed' ? 'line-through text-gray-500' : 'text-gray-900'}`}>{task.title}</h4>
                <div className="flex gap-2 mt-1">
                  {task.points > 0 && <Badge variant="primary">+{task.points} pts</Badge>}
                  {task.money > 0 && <Badge variant="success">+${task.money.toFixed(2)}</Badge>}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
