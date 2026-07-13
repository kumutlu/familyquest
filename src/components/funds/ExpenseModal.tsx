import { useState } from 'react';
import { addFundExpense } from '../../lib/api';
import { Button } from '../ui/Button';

interface ExpenseModalProps {
  fund: any;
  familyId: string;
  onClose: () => void;
  currencySymbol: string;
}

export function ExpenseModal({ fund, familyId, onClose, currencySymbol }: ExpenseModalProps) {
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('Food');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = Math.round(parseFloat(amount) * 100);
    if (!numAmount || numAmount <= 0) return;

    setIsSubmitting(true);
    try {
      await addFundExpense(familyId, fund.id, {
        amount: numAmount,
        category,
        description,
        fundName: fund.name
      });
      onClose();
    } catch {
      alert('Failed to add expense');
    } finally {
      setIsSubmitting(false);
    }
  };

  const categories = ['Food', 'Litter', 'Vet', 'Insurance', 'Toys', 'Grooming', 'Other'];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl w-full max-w-md p-6">
        <h3 className="text-xl font-bold mb-4">Add Expense for {fund.name}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-gray-700">Amount ({currencySymbol})</label>
            <input type="number" step="0.01" min="0.01" required value={amount} onChange={e => setAmount(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700">Category</label>
            <select value={category} onChange={e => setCategory(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md bg-white">
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700">Description</label>
            <input type="text" required placeholder="e.g. Dry Cat Food" value={description} onChange={e => setDescription(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
          </div>
          <div className="flex gap-3 pt-4">
            <Button type="button" variant="secondary" onClick={onClose} fullWidth>Cancel</Button>
            <Button type="submit" fullWidth disabled={isSubmitting}>Save Expense</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
