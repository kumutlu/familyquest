import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Stat } from '../components/ui/Stat';
import { Progress } from '../components/ui/Progress';
import { Flame, Star, Trophy } from 'lucide-react';

export function Dashboard() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Good Morning, Leo! ☀️</h1>
        <p className="text-gray-500">You're doing great this week.</p>
      </header>

      <div className="grid grid-cols-2 gap-4">
        <Stat label="Total Points" value="1,250" icon={<Star />} className="col-span-1" />
        <Stat label="Day Streak" value="5" icon={<Flame className="text-warning-500" />} className="col-span-1" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex justify-between items-center">
            <span>Level 12: Junior Ranger</span>
            <span className="text-primary-600">60%</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Progress value={60} color="primary" />
          <p className="text-xs text-gray-500 mt-2 text-right">400 XP to Level 13</p>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
          <Trophy size={20} className="text-reward-500" />
          Today's Top Tasks
        </h2>
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="bg-white p-4 rounded-2xl border border-gray-100 flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-primary-50 rounded-xl flex items-center justify-center text-primary-600 font-bold">
                  +50
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900">Clean your room</h4>
                  <p className="text-sm text-gray-500">Daily Task</p>
                </div>
              </div>
              <div className="w-6 h-6 border-2 border-gray-200 rounded-full"></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
