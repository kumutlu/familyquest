import React from 'react';
import { cn } from '../../lib/utils';

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  src?: string;
  fallback: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Avatar({ src, fallback, size = 'md', className, ...props }: AvatarProps) {
  const sizes = {
    sm: "w-8 h-8 text-xs",
    md: "w-12 h-12 text-sm",
    lg: "w-16 h-16 text-base",
    xl: "w-24 h-24 text-xl",
  };

  return (
    <div
      className={cn(
        "relative inline-flex items-center justify-center overflow-hidden bg-primary-100 rounded-full",
        sizes[size],
        className
      )}
      {...props}
    >
      {src ? (
        <img src={src} alt="Avatar" className="w-full h-full object-cover" />
      ) : (
        <span className="font-semibold text-primary-700">{fallback}</span>
      )}
    </div>
  );
}
