import type { ReactNode } from 'react';

interface OnboardingVisualProps {
  title: string;
  children: ReactNode;
  caption?: ReactNode;
  className?: string;
}

export function OnboardingVisual({ title, children, caption, className = '' }: OnboardingVisualProps) {
  return (
    <div
      role="img"
      aria-label={title}
      className={[
        'relative flex aspect-[4/3] w-full max-w-md items-center justify-center overflow-hidden rounded-[2rem]',
        'border border-white/60 bg-white/45 shadow-[0_24px_80px_-36px_rgba(79,70,229,0.45)] backdrop-blur-sm',
        'dark:border-white/10 dark:bg-slate-900/45 dark:shadow-[0_24px_80px_-36px_rgba(129,140,248,0.35)]',
        className,
      ].join(' ')}
    >
      <div aria-hidden="true" className="absolute -left-12 -top-12 h-40 w-40 rounded-full bg-amber-200/55 blur-3xl dark:bg-amber-500/15" />
      <div aria-hidden="true" className="absolute -bottom-16 -right-10 h-44 w-44 rounded-full bg-indigo-300/50 blur-3xl dark:bg-indigo-500/20" />
      <div className="relative flex h-full w-full items-center justify-center p-6">{children}</div>
      {caption ? <div className="absolute inset-x-5 bottom-4 rounded-2xl bg-white/75 px-4 py-2 text-center text-sm font-semibold text-slate-700 backdrop-blur dark:bg-slate-950/65 dark:text-slate-200">{caption}</div> : null}
    </div>
  );
}
