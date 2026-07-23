import React from 'react';
import { cn } from '../../lib/utils';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number;
  max?: number;
  color?: 'primary' | 'success' | 'warning' | 'danger' | 'reward';
}

export function Progress({ value, max = 100, color = 'primary', className, ...props }: ProgressProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  const colors = {
    primary: "bg-primary-500",
    success: "bg-success-500",
    warning: "bg-warning-500",
    danger: "bg-danger-500",
    reward: "bg-reward-500",
  };

  return (
    <div
      className={cn("w-full bg-gray-200 rounded-full h-2.5 overflow-hidden", className)}
      {...props}
    >
      <div
        role="progressbar"
        aria-valuenow={Math.round(percentage)}
        aria-valuemin={0}
        aria-valuemax={100}
        className={cn("h-2.5 rounded-full transition-all duration-500 ease-out", colors[color])}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}