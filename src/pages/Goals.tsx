import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { GoalCard } from '../components/goals/GoalCard';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { createGoal } from '../lib/api';
import { normalizeGoalDoc, type GoalKind } from '../lib/goalContracts';
import { Target, Plus } from 'lucide-react';

export function Goals() {
  const navigate = useNavigate();
  const { currentUser, familyData, savingsGoals, familyMembers } = useStore();

  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<GoalKind>('family');
  const [childId, setChildId] = useState('');
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const goals = useMemo(() => savingsGoals.map(normalizeGoalDoc), [savingsGoals]);

  const familyGoals = goals.filter(g => g.kind === 'family');
  const childGoals = goals.filter(g => g.kind === 'child');

  const children = familyMembers.filter(m => m.role === 'child');

  const reset = () => {
    setTitle('');
    setKind('family');
    setChildId('');
    setTarget('');
    setError('');
  };

  const handleCreate = async () => {
    if (!currentUser || !familyData) return;
    const targetPence = Math.round((parseFloat(target) || 0) * 100);
    if (!title.trim()) { setError('Give the goal a title.'); return; }
    if (targetPence <= 0) { setError('Target must be greater than zero.'); return; }
    if (kind === 'child' && !childId) { setError('Pick a child for this goal.'); return; }

    setSubmitting(true);
    setError('');
    try {
      await createGoal(familyData.id, {
        title: title.trim(),
        kind,
        targetAmountPence: targetPence,
        childId: kind === 'child' ? childId : undefined,
      });
      reset();
      setShowCreate(false);
    } catch (err: any) {
      setError(err?.message || 'Could not create goal.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 flex items-center gap-2">
            <Target size={24} className="text-primary-500" /> Goals
          </h1>
          <p className="text-sm text-gray-500 font-medium mt-1">Save together for what matters</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus size={18} className="mr-1" /> New Goal
        </Button>
      </div>

      <Section title="Family Goals" goals={familyGoals} onOpen={(id) => navigate(`/goals/${id}`)} emptyHint="No family goals yet. Create one to save together!" />
      <Section title="Child Goals" goals={childGoals} onOpen={(id) => navigate(`/goals/${id}`)} emptyHint="No child goals yet." />

      <Modal
        isOpen={showCreate}
        onClose={() => { reset(); setShowCreate(false); }}
        title="Create a Goal"
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" fullWidth onClick={() => { reset(); setShowCreate(false); }} disabled={submitting}>Cancel</Button>
            <Button fullWidth onClick={handleCreate} disabled={submitting}>{submitting ? 'Creating…' : 'Create Goal'}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-500 focus:outline-none font-medium"
              placeholder="e.g. Family Holiday"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Type</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setKind('family')}
                className={`py-3 rounded-xl border-2 font-semibold transition-colors ${kind === 'family' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600'}`}
              >
                👨‍👩‍👧‍👦 Family
              </button>
              <button
                type="button"
                onClick={() => setKind('child')}
                className={`py-3 rounded-xl border-2 font-semibold transition-colors ${kind === 'child' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600'}`}
              >
                🎯 Child
              </button>
            </div>
          </div>

          {kind === 'child' && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Child</label>
              <select
                value={childId}
                onChange={(e) => setChildId(e.target.value)}
                className="w-full px-3 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-500 focus:outline-none font-medium bg-white"
              >
                <option value="">Select a child…</option>
                {children.map(c => <option key={c.id} value={c.id}>{c.displayName}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Target amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">{familyData?.currency || '£'}</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="w-full pl-8 pr-3 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-500 focus:outline-none font-bold"
                placeholder="0.00"
              />
            </div>
          </div>

          {error && <p className="text-sm text-danger-600 font-medium">{error}</p>}
        </div>
      </Modal>
    </div>
  );
}

function Section({ title, goals, onOpen, emptyHint }: {
  title: string;
  goals: ReturnType<typeof normalizeGoalDoc>[];
  onOpen: (id: string) => void;
  emptyHint: string;
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold text-gray-900 px-1">{title}</h2>
      {goals.length === 0 ? (
        <div className="bg-gray-50 rounded-2xl p-8 text-center border border-gray-100">
          <span className="text-4xl mb-3 block">🎯</span>
          <p className="text-gray-500 font-medium">{emptyHint}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {goals.map(g => (
            <GoalCard key={g.goalId} goal={g} onClick={() => onOpen(g.goalId!)} />
          ))}
        </div>
      )}
    </div>
  );
}
