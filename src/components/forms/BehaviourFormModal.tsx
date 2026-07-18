import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { useStore } from '../../store/useStore';
import { addBehaviourEvent } from '../../lib/api';

interface BehaviourFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  childrenList: { id: string; displayName: string; walletBalance?: number }[];
}

export function BehaviourFormModal({ isOpen, onClose, childrenList }: BehaviourFormModalProps) {
  const { currentUser, familyData } = useStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    childId: '',
    type: 'positive' as 'positive' | 'negative' | 'financial',
    reason: '',
    magnitude: ''
  });

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !familyData) return;

    setError(null);
    setIsSubmitting(true);

    try {
      const type = formData.type;
      const magValue = Number(formData.magnitude);

      let pointsDelta = 0;
      let walletDelta = 0;

      if (type === 'positive') {
        pointsDelta = magValue;
      } else if (type === 'negative') {
        pointsDelta = -Math.abs(magValue);
      } else if (type === 'financial') {
        // Convert input currency to negative pence
        walletDelta = -Math.abs(Math.round(magValue * 100));
      }

      await addBehaviourEvent(
        familyData.id,
        formData.childId,
        currentUser.id,
        {
          type,
          reason: formData.reason,
          pointsDelta,
          walletDelta
        }
      );

      // Reset and close on success
      setFormData({ childId: '', type: 'positive', reason: '', magnitude: '' });
      onClose();
    } catch (err: any) {
      console.error('Error logging behaviour:', err);
      setError(err.message || 'Failed to log behaviour event.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const currencySymbol = familyData?.currency || '£';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-xl overflow-hidden flex flex-col max-h-[90vh] animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-10 duration-300">
        <div className="px-6 py-4 flex justify-between items-center border-b border-gray-100">
          <h3 className="text-xl font-bold text-gray-900">Log Behaviour</h3>
          <button onClick={onClose} className="p-2 -mr-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-500">✕</button>
        </div>

        <div className="p-6 overflow-y-auto">
          {error && (
            <div className="mb-4 p-3 bg-danger-50 border border-danger-200 text-danger-700 text-sm rounded-lg">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Type</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, type: 'positive' })}
                  className={`flex-1 py-2 text-sm font-bold rounded-lg border ${formData.type === 'positive' ? 'bg-success-50 text-success-700 border-success-200' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
                >
                  Positive
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, type: 'negative' })}
                  className={`flex-1 py-2 text-sm font-bold rounded-lg border ${formData.type === 'negative' ? 'bg-danger-50 text-danger-700 border-danger-200' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
                >
                  Negative
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, type: 'financial' })}
                  className={`flex-1 py-2 text-sm font-bold rounded-lg border ${formData.type === 'financial' ? 'bg-warning-50 text-warning-700 border-warning-200' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
                >
                  Penalty
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Child</label>
              <select required value={formData.childId} onChange={e => setFormData({...formData, childId: e.target.value})} className="block w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:ring-primary-500 focus:border-primary-500">
                <option value="" disabled>Select a child</option>
                {childrenList.map(c => (
                  <option key={c.id} value={c.id}>{c.displayName}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Reason</label>
              <input type="text" required minLength={3} placeholder="e.g. Helped with groceries" value={formData.reason} onChange={e => setFormData({...formData, reason: e.target.value})} className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-primary-500 focus:border-primary-500" />
            </div>

            {formData.type !== 'financial' ? (
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Points</label>
                <input type="number" required min="1" step="1" value={formData.magnitude} onChange={e => setFormData({...formData, magnitude: e.target.value})} className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-primary-500 focus:border-primary-500" placeholder="e.g. 50" />
              </div>
            ) : (
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Penalty Amount ({currencySymbol})</label>
                <input type="number" required min="0.01" step="0.01" value={formData.magnitude} onChange={e => setFormData({...formData, magnitude: e.target.value})} className="block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-primary-500 focus:border-primary-500" placeholder="e.g. 5.00" />
              </div>
            )}

            <div className="pt-4">
              <Button type="submit" fullWidth disabled={isSubmitting} className={formData.type === 'positive' ? "bg-success-500 hover:bg-success-600" : formData.type === 'negative' ? "bg-danger-500 hover:bg-danger-600" : "bg-warning-500 hover:bg-warning-600 text-white"}>
                {isSubmitting ? 'Saving...' : 'Log Event'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
