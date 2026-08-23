import React from 'react';
import { cn } from '../../lib/utils';

export interface SurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  /** `card` = resting surface, `raised` = above content (sheets, popovers), `inset` = wells. */
  level?: 'page' | 'card' | 'raised' | 'inset';
}

/** Semantic surface container bound to the Queki v2 elevation tokens. */
export function Surface({ level = 'card', className, ...props }: SurfaceProps) {
  const levelClass = {
    page: 'qk-bg-page',
    card: 'qk-bg-card qk-shadow-card',
    raised: 'qk-bg-raised shadow-lg',
    inset: 'qk-bg-inset',
  }[level];

  return <div className={cn(levelClass, className)} {...props} />;
}
