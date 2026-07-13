import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { createReward, updateReward } from '../../lib/api';
import { REWARD_TEMPLATES } from '../../lib/templates';
import { Button } from '../ui/Button';

interface RewardFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  rewardToEdit?: any;
}

export function RewardFormModal({ isOpen, onClose, rewardToEdit }: RewardFormModalProps) {
  const { currentUser } = useStore();

  const [formData, setFormData] = useState<any>({
    title: '', description: '', cost: 50, icon: 'Gift', inventory: '', isActive: true
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (rewardToEdit) {
        setFormData({ ...rewardToEdit, isActive: rewardToEdit.isActive !== false });
      } else {
        setFormData({ title: '', description: '', cost: 50, icon: 'Gift', inventory: '', isActive: true });
      }
      setError(null);
    }
  }, [isOpen, rewardToEdit]);

  if (!isOpen) return null;

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const dataToSave = {
        title: formData.title,
        description: formData.description,
        cost: Number(formData.cost),
        icon: formData.icon,
        isActive: formData.isActive,
        inventory: formData.inventory === '' ? null : Number(formData.inventory)
      };

      if (formData.id) {
        await updateReward(currentUser.familyId, formData.id, dataToSave);
      } else {
        await createReward(currentUser.familyId, dataToSave);
      }
      onClose();
    } catch (e: any) {
      setError(e.message);
    }
    setIsSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-xl overflow-hidden flex flex-col max-h-[90vh] animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-10 duration-300">
        <div className="px-6 py-4 flex justify-between items-center border-b border-gray-100">
          <h3 className="text-xl font-bold text-gray-900">{formData.id ? 'Edit Reward' : 'New Reward'}</h3>
          <button onClick={onClose} className="p-2 -mr-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-500">✕</button>
        </div>
        <div className="p-6 overflow-y-auto">
          {!formData.id && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">Or choose a template:</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm"
                onChange={(e) => {
                  if (!e.target.value) return;
                  const tmpl = JSON.parse(e.target.value);
                  let icon = 'Gift';
                  if (tmpl.category === 'Screen Time' || tmpl.category === 'Activities') icon = 'Gamepad2';
                  if (tmpl.category === 'Special') icon = 'Ticket';
                  setFormData({ ...formData, title: tmpl.title, cost: tmpl.points, icon });
                }}
              >
                <option value="">Select a template...</option>
                {REWARD_TEMPLATES.map((tmpl, idx) => (
                  <option key={idx} value={JSON.stringify(tmpl)}>
                    {tmpl.category} - {tmpl.title} ({tmpl.points} pts)
                  </option>
                ))}
              </select>
            </div>
          )}
          <form onSubmit={handleFormSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Reward Name</label>
              <input type="text" required value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Description (Optional)</label>
              <textarea rows={2} value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Cost (Points)</label>
                <input type="number" required min="1" value={formData.cost} onChange={e => setFormData({...formData, cost: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Available Quantity (Optional)</label>
                <input type="number" min="0" placeholder="Unlimited" value={formData.inventory} onChange={e => setFormData({...formData, inventory: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Icon / Category</label>
              <select value={formData.icon} onChange={e => setFormData({...formData, icon: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md bg-white">
                <option value="Gift">Gift / Item</option>
                <option value="Gamepad2">Screen Time / Gaming</option>
                <option value="Pizza">Food / Treat</option>
                <option value="Ticket">Experience / Outing</option>
              </select>
            </div>
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2">
                <input type="checkbox" id="activeReward" checked={formData.isActive} onChange={e => setFormData({...formData, isActive: e.target.checked})} className="w-4 h-4 text-success-600 rounded border-gray-300 focus:ring-success-500" />
                <label htmlFor="activeReward" className="text-sm font-medium text-gray-700">Active Status</label>
              </div>
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <div className="pt-4">
              <Button type="submit" fullWidth disabled={isSubmitting} className="bg-reward-500 hover:bg-reward-600">
                {isSubmitting ? 'Saving...' : 'Save Reward'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
