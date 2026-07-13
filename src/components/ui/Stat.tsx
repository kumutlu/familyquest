import React from 'react';
import { cn } from '../../lib/utils';
import { ChevronRight } from 'lucide-react';

interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
}

export function Stat({ label, value, icon, className, onClick, ...props }: StatProps) {
  const isClickable = !!onClick;

  return (
    <div
      onClick={onClick}
      className={cn(
        "bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center space-x-4",
        isClickable && "cursor-pointer hover:border-primary-300 hover:shadow-md transition-all active:scale-95 group",
        className
      )}
      {...props}
    >
      {icon && (
        <div className="p-3 bg-primary-50 rounded-xl text-primary-500 shrink-0">
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-500 truncate group-hover:text-primary-600 transition-colors">{label}</p>
        <h4 className="text-2xl font-bold text-gray-900 truncate">{value}</h4>
      </div>
      {isClickable && (
        <div className="shrink-0 text-gray-300 group-hover:text-primary-500 transition-colors">
          <ChevronRight size={20} />
        </div>
      )}
    </div>
  );
}
