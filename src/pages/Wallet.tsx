import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { Card, CardContent } from '../components/ui/Card';
import { Progress } from '../components/ui/Progress';
import { ArrowDownLeft, ArrowUpRight, Plus, Target, PiggyBank } from 'lucide-react';

export function Wallet() {
  const [activeTab, setActiveTab] = useState<'ledger' | 'goals'>('ledger');

  const transactions = [
    { id: 1, title: 'Weekly Allowance', amount: 5.00, type: 'credit', date: 'Today, 9:00 AM' },
    { id: 2, title: 'Walked the dog', amount: 0.50, type: 'credit', date: 'Yesterday' },
    { id: 3, title: 'Roblox Gift Card', amount: -4.99, type: 'debit', date: 'Oct 12' },
    { id: 4, title: 'Birthday Gift from Grandma', amount: 20.00, type: 'credit', date: 'Oct 10' },
  ];

  const goals = [
    { id: 1, title: 'New Bicycle', current: 45, target: 120, color: 'primary' as const },
    { id: 2, title: 'Video Game', current: 24.50, target: 60, color: 'success' as const },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="bg-gray-900 text-white p-6 rounded-3xl shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10">
          <svg viewBox="0 0 100 100" className="w-48 h-48 fill-white"><circle cx="50" cy="50" r="50"/></svg>
        </div>
        <div className="relative z-10">
          <p className="text-gray-400 font-medium mb-1 text-sm uppercase tracking-wider">Total Real Money</p>
          <h1 className="text-5xl font-extrabold tracking-tight">$24.50</h1>
          
          <div className="flex gap-3 mt-8">
            <Button variant="secondary" className="bg-white/10 hover:bg-white/20 text-white border-0 flex-1 h-12">
              <PiggyBank size={18} className="mr-2" /> Add Savings
            </Button>
          </div>
        </div>
      </div>

      <div className="flex gap-2 p-1 bg-gray-100 rounded-xl">
        <button 
          onClick={() => setActiveTab('ledger')}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${activeTab === 'ledger' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
        >
          Transactions
        </button>
        <button 
          onClick={() => setActiveTab('goals')}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${activeTab === 'goals' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
        >
          Savings Goals
        </button>
      </div>

      {activeTab === 'ledger' && (
        <div className="animate-in slide-in-from-left-2 duration-200">
          <h2 className="text-lg font-bold text-gray-900 mb-4 px-1">Ledger</h2>
          <div className="space-y-3">
            {transactions.map(tx => (
              <Card key={tx.id} className="hover:border-primary-100 transition-colors">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`p-2.5 rounded-xl ${tx.type === 'credit' ? 'bg-success-50 text-success-600' : 'bg-gray-50 text-gray-600'}`}>
                      {tx.type === 'credit' ? <ArrowDownLeft size={20} strokeWidth={2.5} /> : <ArrowUpRight size={20} strokeWidth={2.5} />}
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900">{tx.title}</h4>
                      <p className="text-xs text-gray-500 font-medium mt-0.5">{tx.date}</p>
                    </div>
                  </div>
                  <div className={`font-bold text-lg ${tx.type === 'credit' ? 'text-success-600' : 'text-gray-900'}`}>
                    {tx.type === 'credit' ? '+' : '-'}${Math.abs(tx.amount).toFixed(2)}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'goals' && (
        <div className="space-y-4 animate-in slide-in-from-right-2 duration-200">
          <div className="flex justify-between items-center px-1">
            <h2 className="text-lg font-bold text-gray-900">Your Goals</h2>
            <Button size="sm" variant="ghost" className="text-primary-600 px-2"><Plus size={18} className="mr-1"/> New Goal</Button>
          </div>
          
          {goals.map(goal => (
            <Card key={goal.id}>
              <CardContent className="p-5">
                <div className="flex justify-between items-end mb-3">
                  <div>
                    <h4 className="font-bold text-gray-900 text-lg flex items-center gap-2">
                      <Target size={18} className="text-gray-400" />
                      {goal.title}
                    </h4>
                  </div>
                  <div className="text-right">
                    <span className="text-xl font-extrabold text-gray-900">${goal.current.toFixed(2)}</span>
                    <span className="text-sm text-gray-500 font-medium"> / ${goal.target.toFixed(2)}</span>
                  </div>
                </div>
                <Progress value={(goal.current / goal.target) * 100} color={goal.color} className="h-3" />
                <p className="text-xs text-gray-500 mt-3 text-right font-medium">
                  ${(goal.target - goal.current).toFixed(2)} more to go!
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
