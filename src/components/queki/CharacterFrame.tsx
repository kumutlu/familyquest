import React from 'react';
import { cn } from '../../lib/utils';

export interface CharacterFrameProps {
  /** Avatar image URL, if the member has one. */
  src?: string;
  /** Fallback initial(s). */
  fallback?: string;
  /** Frame size in px. */
  size?: number;
  /** Ring identity colour (CSS colour value). */
  ringColor?: string;
  /** Emphasised hero treatment (larger inner glow). */
  hero?: boolean;
  className?: string;
  'aria-label'?: string;
}

/**
 * CharacterFrame — presents a family member's avatar as the central character
 * of a Living Home. A circular frame with a brand ring and soft glow; the
 * child's own frame is intended to feel like "you" on the Child Living Home.
 */
export function CharacterFrame({
  src,
  fallback,
  size = 88,
  ringColor,
  hero = false,
  className,
  'aria-label': ariaLabel,
}: CharacterFrameProps) {
  const imgFailedRef = React.useRef(false);
  const [failed, setFailed] = React.useState(false);
  if (src && imgFailedRef.current === false && failed) imgFailedRef.current = true;

  const showImage = src && !failed;
  const ring = ringColor ?? 'var(--color-primary-500)';

  return (
    <span
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      className={cn('relative inline-flex shrink-0 items-center justify-center rounded-full', className)}
      style={{ width: size, height: size }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-[-4px] rounded-full opacity-60 blur-[6px]"
        style={{ background: hero ? ring : 'transparent' }}
      />
      <span
        className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-full border-[3px] qk-bg-card"
        style={{ borderColor: ring }}
      >
        {showImage ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <span
            className="font-balance flex h-full w-full items-center justify-center bg-primary-50 text-primary-600"
            style={{ fontSize: size * 0.36 }}
          >
            {(fallback || '?').slice(0, 2).toUpperCase()}
          </span>
        )}
      </span>
    </span>
  );
}
