import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageLoader } from '../components/ui/PageLoader';
import { Button } from '../components/ui/Button';
import { useStore } from '../store/useStore';
import { completeTask, createTask, updateTask } from '../lib/api';
import { useRecurrenceClock } from '../lib/useRecurrenceClock';
import { isChildRole } from '../lib/roles';
import { TaskDetailsModal } from '../components/tasks/TaskDetailsModal';
import { QuestBoard } from '../components/quests/QuestBoard';
import { ParentQuestBoard } from '../components/parent/ParentQuestBoard';

export function Tasks() {
  const { t } = useTranslation(['tasks', 'errors']);
  const { currentUser, loading, familyMembers } = useStore();
  const [selectedTask, setSelectedTask] = useState<any>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formData, setFormData] = useState<any>({ title: '', pointsReward: 10, type: 'daily', requiresApproval: true, assigneeId: '' });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Open-session clock: re-derives availability when the local day/week
  // boundary crosses while the app stays open (no full reload needed).
  const now = useRecurrenceClock();

  if (loading) return <PageLoader label={t('tasks:loading')} />;

  // Queki v2 Wave 2: children get the touch-first Quest Board; parents keep
  // full management via the v2 Parent Quest Board (create/edit/archive all
  // preserved behind the same modals as before).
  if (isChildRole(currentUser?.role)) {
    return <QuestBoard />;
  }

  // Availability/status derivation for the management list now lives in the
  // pure selectors consumed by ParentQuestBoard (same taskRecurrence engine).

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
      await completeTask(currentUser.familyId, selectedTask.id, currentUser.id, selectedTask.requiresApproval, now);
      setTimeout(() => {
        setSelectedTask(null);
        setIsSubmitting(false);
      }, 1500);
    } catch (e: any) {
      console.error(e);
      setError(e.message || t('errors:completeTaskFailed'));
      setIsSubmitting(false);
    }
  };

  const openCreateForm = () => {
    setFormData({ title: '', pointsReward: 10, type: 'daily', requiresApproval: true, assigneeId: '' });
    setIsFormOpen(true);
  };

  const openEditForm = (task: any) => {
    setFormData({ ...task, assigneeId: task.assigneeId || '' });
    setSelectedTask(null);
    setIsFormOpen(true);
  };

  const handleArchive = async (taskId: string) => {
    if (!currentUser) return;
    if (confirm(t('errors:archiveTaskConfirm'))) {
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
          requiresApproval: formData.requiresApproval,
          assigneeId: formData.assigneeId || null
        });
        setSuccessMsg(t('tasks:updateSuccess'));
      } else {
        await createTask(currentUser.familyId, {
          title: formData.title,
          pointsReward: Number(formData.pointsReward),
          type: formData.type,
          requiresApproval: formData.requiresApproval,
          assigneeId: formData.assigneeId || null
        });
        setSuccessMsg(t('tasks:createSuccess'));
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
      {successMsg && (
        <div className="bg-success-50 text-success-700 p-3 rounded-xl mb-4 text-sm font-medium animate-in fade-in slide-in-from-top-2">
          {successMsg}
        </div>
      )}

      <ParentQuestBoard onOpenTask={handleTaskClick} onCreate={openCreateForm} />

      {/* Task Details Modal */}
      {selectedTask && (
        <TaskDetailsModal
          task={selectedTask}
          currentUserRole={currentUser?.role}
          isSubmitting={isSubmitting}
          error={error}
          onClose={() => setSelectedTask(null)}
          onEdit={openEditForm}
          onArchive={handleArchive}
          onComplete={handleComplete}
        />
      )}

      {/* Create/Edit Form Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-xl overflow-hidden flex flex-col max-h-[90vh] animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-10 duration-300">
            <div className="px-6 py-4 flex justify-between items-center border-b border-gray-100">
              <h3 className="text-xl font-bold text-gray-900">{formData.id ? t('tasks:form.editTitle') : t('tasks:form.newTitle')}</h3>
              <button onClick={() => setIsFormOpen(false)} className="p-2 -mr-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-500">✕</button>
            </div>
            <div className="p-6 overflow-y-auto">
              <form onSubmit={handleFormSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">{t('tasks:form.taskTitle')}</label>
                  <input type="text" required value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">{t('tasks:form.pointsReward')}</label>
                  <input type="number" required min="1" value={formData.pointsReward} onChange={e => setFormData({...formData, pointsReward: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">{t('tasks:form.assignedChild')}</label>
                  <select value={formData.assigneeId} onChange={e => setFormData({...formData, assigneeId: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md bg-white">
                    <option value="">{t('tasks:form.anyoneShared')}</option>
                    {familyMembers.filter(m => m.role === 'child').map(child => (
                      <option key={child.id} value={child.id}>{child.displayName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">{t('tasks:form.category')}</label>
                  <select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md bg-white">
                    <option value="daily">{t('tasks:form.schedule.daily')}</option>
                    <option value="weekdays">{t('tasks:form.schedule.weekdays')}</option>
                    <option value="weekends">{t('tasks:form.schedule.weekends')}</option>
                    <option value="weekly">{t('tasks:form.schedule.weekly')}</option>
                    <option value="one-time">{t('tasks:form.schedule.oneTime')}</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <input type="checkbox" id="approval" checked={formData.requiresApproval} onChange={e => setFormData({...formData, requiresApproval: e.target.checked})} className="w-4 h-4 text-primary-600 rounded border-gray-300 focus:ring-primary-500" />
                  <label htmlFor="approval" className="text-sm font-medium text-gray-700">{t('tasks:form.requiresApproval')}</label>
                </div>
                {error && <p className="text-red-500 text-sm">{error}</p>}
                <div className="pt-4">
                  <Button type="submit" fullWidth disabled={isSubmitting}>
                    {isSubmitting ? t('tasks:form.saving') : t('tasks:form.save')}
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