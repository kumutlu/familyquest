import React from 'react';
import { Button } from '../components/ui/Button';
import { Card, CardContent } from '../components/ui/Card';
import { ArrowDownLeft, ArrowUpRight, Plus } from 'lucide-react';

export function Wallet() {
  const transactions = [
    { id: 1, title: 'Weekly Allowance', amount: 5.00, type: 'credit', date: 'Today' },
    { id: 2, title: 'Walked the dog', amount: 0.50, type: 'credit', date: 'Yesterday' },
    { id: 3, title: 'Roblox Gift Card', amount: -4.99, type: 'debit', date: 'Oct 12' },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-gray-900 text-white p-6 rounded-3xl shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10">
          <svg viewBox="0 0 100 100" className="w-48 h-48 fill-white"><circle cx="50" cy="50" r="50"/></svg>
        </div>
        <div className="relative z-10">
          <p className="text-gray-400 font-medium mb-1">Total Balance</p>
          <h1 className="text-4xl font-extrabold tracking-tight">$24.50</h1>
          
          <div className="flex gap-3 mt-6">
            <Button variant="secondary" className="bg-white/10 hover:bg-white/20 text-white border-0 flex-1">
              <Plus size={18} className="mr-2" /> Add Money
            </Button>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-bold text-gray-900 mb-4">Recent Transactions</h2>
        <div className="space-y-3">
          {transactions.map(tx => (
            <Card key={tx.id}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`p-2 rounded-xl ${tx.type === 'credit' ? 'bg-success-50 text-success-600' : 'bg-gray-50 text-gray-600'}`}>
                    {tx.type === 'credit' ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900">{tx.title}</h4>
                    <p className="text-xs text-gray-500">{tx.date}</p>
                  </div>
                </div>
                <div className={`font-bold ${tx.type === 'credit' ? 'text-success-600' : 'text-gray-900'}`}>
                  {tx.type === 'credit' ? '+' : '-'}${Math.abs(tx.amount).toFixed(2)}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
