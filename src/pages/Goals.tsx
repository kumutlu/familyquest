import { useMemo, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HelpButton } from '../help/components/HelpButton';
import { useStore } from '../store/useStore';
import { GoalCard } from '../components/goals/GoalCard';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { createGoal, deleteCancelledGoal } from '../lib/api';
import { normalizeGoalDoc, type GoalKind, type ParentContributionInput } from '../lib/goalContracts';
import { Target, Plus } from 'lucide-react';
import { currencySymbolFromCode, resolveFamilyCurrencyCode } from '../i18n/format';

export function Goals() {
  const navigate = useNavigate();
  const { currentUser, familyData, savingsGoals, familyMembers } = useStore();
  const { t } = useTranslation('goals');
  const currencySymbol = currencySymbolFromCode(resolveFamilyCurrencyCode(familyData));

  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<GoalKind>('family');
  const [childId, setChildId] = useState('');
  const [target, setTarget] = useState('');
  const [parentMode, setParentMode] = useState<'none' | 'fixed' | 'percent'>('none');
  const [parentFixed, setParentFixed] = useState('');
  const [parentPercent, setParentPercent] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Cancelled-goal deletion state.
  const [pendingDelete, setPendingDelete] = useState<{ goalId: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  // Guards against double-submit (duplicate requests) within a single confirmation.
  const deleteInFlight = useRef(false);
  // Locally removed goal ids so the card disappears immediately on success,
  // independent of when the store reflects the Firestore deletion.
  const [removedGoalIds, setRemovedGoalIds] = useState<string[]>([]);

  const goals = useMemo(
    () => savingsGoals.map(normalizeGoalDoc).filter(g => !removedGoalIds.includes(g.goalId!)),
    [savingsGoals, removedGoalIds],
  );

  const familyGoals = goals.filter(g => g.kind === 'family');
  const childGoals = goals.filter(g => g.kind === 'child');

  const children = familyMembers.filter(m => m.role === 'child');

  const reset = () => {
    setTitle('');
    setKind('family');
    setChildId('');
    setTarget('');
    setParentMode('none');
    setParentFixed('');
    setParentPercent('');
    setError('');
  };

  // Switching the parent-contribution mode clears the INACTIVE value so the two
  // modes stay mutually exclusive. Title, target, goal type, and child selection
  // are intentionally left untouched.
  const selectParentMode = (mode: 'none' | 'fixed' | 'percent') => {
    setParentMode(mode);
    if (mode !== 'fixed') setParentFixed('');
    if (mode !== 'percent') setParentPercent('');
  };

  const handleCreate = async () => {
    if (!currentUser || !familyData) return;
    const targetPence = Math.round((parseFloat(target) || 0) * 100);
    if (!title.trim()) { setError(t('create.errorTitle')); return; }
    if (targetPence <= 0) { setError(t('create.errorTarget')); return; }
    if (kind === 'child' && !childId) { setError(t('create.errorChild')); return; }

    const fixedPence = Math.round((parseFloat(parentFixed) || 0) * 100);
    const percent = parseFloat(parentPercent) || 0;
    // Mutually exclusive mode: only the selected mode's value is submitted.
    const parentContribution: ParentContributionInput | undefined =
      parentMode === 'fixed' && fixedPence > 0
        ? { mode: 'fixed', fixedPence }
        : parentMode === 'percent' && percent > 0
          ? { mode: 'percent', percent }
          : undefined;

    setSubmitting(true);
    setError('');
    try {
      await createGoal(familyData.id, {
        title: title.trim(),
        kind,
        targetAmountPence: targetPence,
        childId: kind === 'child' ? childId : undefined,
        parentContribution,
      });
      reset();
      setShowCreate(false);
    } catch (err: any) {
      setError(t('create.errorCreate'));
    } finally {
      setSubmitting(false);
    }
  };

const openDelete = (goal: { goalId?: string; title: string }) => {
  if (!goal.goalId) return;
  setDeleteError('');
  setPendingDelete({ goalId: goal.goalId, title: goal.title });
};

const closeDelete = () => {
  if (deleting) return; // don't allow dismiss while submitting
  setPendingDelete(null);
  setDeleteError('');
};

const confirmDelete = async () => {
    if (!pendingDelete || !familyData) return;
    if (deleteInFlight.current) return; // prevent duplicate requests
    deleteInFlight.current = true;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteCancelledGoal(familyData.id, pendingDelete.goalId, pendingDelete.goalId);
      setRemovedGoalIds(prev => [...prev, pendingDelete.goalId]);
      setPendingDelete(null);
    } catch (err: any) {
      setDeleteError(err?.message || t('delete.error'));
    } finally {
      setDeleting(false);
      deleteInFlight.current = false;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div>
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 flex items-center gap-2">
              <Target size={24} className="text-primary-500" /> {t('title')}
            </h1>
            <HelpButton />
          </div>
          <p className="text-sm text-gray-500 font-medium mt-1">{t('page.subtitle')}</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus size={18} className="mr-1" /> {t('newGoal')}
        </Button>
      </div>

      <Section title={t('list.familyGoals')} goals={familyGoals} onOpen={(id) => navigate(`/goals/${id}`)} onDelete={openDelete} emptyHint={t('list.emptyFamily')} />
      <Section title={t('list.childGoals')} goals={childGoals} onOpen={(id) => navigate(`/goals/${id}`)} onDelete={openDelete} emptyHint={t('list.emptyChild')} />

      <Modal
        isOpen={showCreate}
        onClose={() => { reset(); setShowCreate(false); }}
        title={t('create.title')}
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" fullWidth onClick={() => { reset(); setShowCreate(false); }} disabled={submitting}>{t('create.cancel')}</Button>
            <Button fullWidth onClick={handleCreate} disabled={submitting}>{submitting ? t('create.creating') : t('create.submit')}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">{t('create.titleLabel')}</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-500 focus:outline-none font-medium"
              placeholder={t('create.titlePlaceholder')}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">{t('create.typeLabel')}</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setKind('family')}
                className={`py-3 rounded-xl border-2 font-semibold transition-colors ${kind === 'family' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600'}`}
              >
                👨‍👩‍👧‍👦 {t('create.family')}
              </button>
              <button
                type="button"
                onClick={() => setKind('child')}
                className={`py-3 rounded-xl border-2 font-semibold transition-colors ${kind === 'child' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600'}`}
              >
                🎯 {t('create.child')}
              </button>
            </div>
          </div>

          {kind === 'child' && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">{t('create.childLabel')}</label>
              <select
                value={childId}
                onChange={(e) => setChildId(e.target.value)}
                className="w-full px-3 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-500 focus:outline-none font-medium bg-white"
              >
                <option value="">{t('create.selectChild')}</option>
                {children.map(c => <option key={c.id} value={c.id}>{c.displayName}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">{t('create.targetLabel')}</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">{currencySymbol}</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="w-full pl-8 pr-3 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-500 focus:outline-none font-bold"
                placeholder={t('create.targetPlaceholder')}
              />
            </div>
          </div>

          <div className="rounded-xl border-2 border-dashed border-gray-200 p-4 space-y-3">
            <div>
              <p className="text-sm font-semibold text-gray-700">{t('create.parentContributionTitle')}</p>
              <p className="text-xs text-gray-400 mt-0.5">{t('create.parentContributionHint')}</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => selectParentMode('none')}
                className={`py-2 rounded-xl border-2 font-semibold transition-colors text-sm ${parentMode === 'none' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600'}`}
              >
                {t('create.none')}
              </button>
              <button
                type="button"
                onClick={() => selectParentMode('fixed')}
                className={`py-2 rounded-xl border-2 font-semibold transition-colors text-sm ${parentMode === 'fixed' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600'}`}
              >
                {t('create.fixed')}
              </button>
              <button
                type="button"
                onClick={() => selectParentMode('percent')}
                className={`py-2 rounded-xl border-2 font-semibold transition-colors text-sm ${parentMode === 'percent' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600'}`}
              >
                {t('create.percentage')}
              </button>
            </div>
            {parentMode === 'fixed' && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('create.fixedLabel')}</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">{currencySymbol}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={parentFixed}
                    onChange={(e) => setParentFixed(e.target.value)}
                    className="w-full pl-8 pr-3 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-500 focus:outline-none font-bold"
                    placeholder={t('create.targetPlaceholder')}
                  />
                </div>
              </div>
            )}
            {parentMode === 'percent' && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('create.percentLabel')}</label>
                <div className="relative">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="100"
                    step="1"
                    value={parentPercent}
                    onChange={(e) => setParentPercent(e.target.value)}
                    className="w-full pl-3 pr-8 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-500 focus:outline-none font-bold"
                    placeholder={t('create.percentPlaceholder')}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">%</span>
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-danger-600 font-medium">{error}</p>}
        </div>
      </Modal>

      <Modal
        isOpen={pendingDelete !== null}
        onClose={closeDelete}
        title={t('delete.title')}
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" fullWidth onClick={closeDelete} disabled={deleting}>{t('delete.cancel')}</Button>
            <Button variant="danger" fullWidth onClick={confirmDelete} disabled={deleting}>
              {deleting ? t('delete.deleting') : t('delete.delete')}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-gray-600">
          {t('delete.body')}
        </p>
        {deleteError && <p className="mt-3 text-sm text-danger-600 font-medium">{deleteError}</p>}
      </Modal>
    </div>
  );
}

function Section({ title, goals, onOpen, onDelete, emptyHint }: {
  title: string;
  goals: ReturnType<typeof normalizeGoalDoc>[];
  onOpen: (id: string) => void;
  onDelete?: (goal: any) => void;
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
            <GoalCard key={g.goalId} goal={g} onClick={() => onOpen(g.goalId!)} onDelete={onDelete ? () => onDelete(g) : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}
