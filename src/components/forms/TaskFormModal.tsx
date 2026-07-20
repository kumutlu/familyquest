import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import { createTask, updateTask } from '../../lib/api';
import { TASK_TEMPLATES } from '../../lib/templates';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';

interface TaskFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskToEdit?: any;
}

export function TaskFormModal({ isOpen, onClose, taskToEdit }: TaskFormModalProps) {
  const { t } = useTranslation(['tasks', 'errors']);
  const { currentUser, familyMembers } = useStore();

  const [formData, setFormData] = useState<any>({
    title: '', description: '', pointsReward: 10, type: 'daily', customDays: [], requiresApproval: true, assigneeId: '', isActive: true
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      if (taskToEdit) {
        setFormData({ ...taskToEdit, customDays: taskToEdit.customDays || [], isActive: taskToEdit.isActive !== false });
      } else {
        setFormData({ title: '', description: '', pointsReward: 10, type: 'daily', customDays: [], requiresApproval: true, assigneeId: '', isActive: true });
      }
      setError(null);
      submittingRef.current = false;
    }
  }, [isOpen, taskToEdit]);

  if (!isOpen) return null;

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Prevent double submission: a synchronous ref guard that survives
    // rapid repeated clicks before React re-renders the disabled button.
    if (submittingRef.current) return;
    if (!currentUser) {
      setError(t('errors:signInRequired'));
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      const dataToSave = {
        title: formData.title,
        description: formData.description,
        pointsReward: Number(formData.pointsReward),
        type: formData.type,
        customDays: formData.type === 'custom' ? formData.customDays : [],
        requiresApproval: formData.requiresApproval,
        assigneeId: formData.assigneeId || null,
        isActive: formData.isActive
      };

      if (formData.id) {
        await updateTask(currentUser.familyId, formData.id, dataToSave);
      } else {
        await createTask(currentUser.familyId, dataToSave);
      }
      // Only close/reset after the atomic write batch has committed.
      onClose();
    } catch (e: any) {
      setError(e?.message || t('errors:saveTaskFailed'));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-xl overflow-hidden flex flex-col max-h-[90vh] animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-10 duration-300">
        <div className="px-6 py-4 flex justify-between items-center border-b border-gray-100">
          <h3 className="text-xl font-bold text-gray-900">{formData.id ? t('tasks:form.editTitle') : t('tasks:form.newTitle')}</h3>
          <button onClick={onClose} className="p-2 -mr-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-500">✕</button>
        </div>
        <div className="p-6 overflow-y-auto">
          {!formData.id && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('tasks:form.templateLabel')}</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm"
                onChange={(e) => {
                  if (!e.target.value) return;
                  const tmpl = JSON.parse(e.target.value);
                  setFormData({ ...formData, title: tmpl.title, pointsReward: tmpl.points });
                }}
              >
                <option value="">{t('tasks:form.templatePlaceholder')}</option>
                {TASK_TEMPLATES.map((tmpl, idx) => (
                  <option key={idx} value={JSON.stringify(tmpl)}>
                    {tmpl.category} - {tmpl.title} ({tmpl.points} pts)
                  </option>
                ))}
              </select>
            </div>
          )}
          <form onSubmit={handleFormSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">{t('tasks:form.taskTitle')}</label>
              <input type="text" required value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">{t('tasks:form.description')}</label>
              <textarea rows={2} value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
            </div>
            <div className="grid grid-cols-2 gap-4">
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
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">{t('tasks:form.category')}</label>
              <select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md bg-white">
                <option value="daily">{t('tasks:form.schedule.daily')}</option>
                <option value="weekdays">{t('tasks:form.schedule.weekdays')}</option>
                <option value="weekends">{t('tasks:form.schedule.weekends')}</option>
                <option value="weekly">{t('tasks:form.schedule.weekly')}</option>
                <option value="custom">{t('tasks:form.schedule.custom')}</option>
                <option value="one-time">{t('tasks:form.schedule.oneTime')}</option>
              </select>
            </div>
            {formData.type === 'custom' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('tasks:form.selectDays')}</label>
                <div className="flex gap-2 justify-between">
                  {['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(day => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => {
                        const newDays = formData.customDays.includes(day)
                          ? formData.customDays.filter((d: string) => d !== day)
                          : [...formData.customDays, day];
                        setFormData({ ...formData, customDays: newDays });
                      }}
                      className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold transition-colors border",
                        formData.customDays.includes(day)
                          ? "bg-primary-500 text-white border-primary-500 shadow-sm"
                          : "bg-white text-gray-500 border-gray-200 hover:border-primary-300"
                      )}
                    >
                      {day.charAt(0).toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2">
                <input type="checkbox" id="approval" checked={formData.requiresApproval} onChange={e => setFormData({...formData, requiresApproval: e.target.checked})} className="w-4 h-4 text-primary-600 rounded border-gray-300 focus:ring-primary-500" />
                <label htmlFor="approval" className="text-sm font-medium text-gray-700">{t('tasks:form.requiresApproval')}</label>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="active" checked={formData.isActive} onChange={e => setFormData({...formData, isActive: e.target.checked})} className="w-4 h-4 text-success-600 rounded border-gray-300 focus:ring-success-500" />
                <label htmlFor="active" className="text-sm font-medium text-gray-700">{t('tasks:form.active')}</label>
              </div>
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
  );
}
