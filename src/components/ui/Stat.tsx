import React from 'react';
import { cn } from '../../lib/utils';

interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
}

export function Stat({ label, value, icon, className, ...props }: StatProps) {
  return (
    <div className={cn("bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center space-x-4", className)} {...props}>
      {icon && (
        <div className="p-3 bg-primary-50 rounded-xl text-primary-500">
          {icon}
        </div>
      )}
      <div>
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <h4 className="text-2xl font-bold text-gray-900">{value}</h4>
      </div>
    </div>
  );
}
