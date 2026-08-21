import type { ReactNode } from 'react';

interface PublicAuthShellProps {
  children: ReactNode;
  visual: ReactNode;
  visualTitle: ReactNode;
  visualCopy?: ReactNode;
  mobileVisual?: ReactNode;
}

export function PublicAuthShell({ children, visual, visualTitle, visualCopy, mobileVisual }: PublicAuthShellProps) {
  return (
    <div
      data-testid="public-auth-shell"
      className="relative min-h-dvh overflow-hidden bg-gradient-to-br from-amber-50 via-white to-indigo-50 text-slate-900 dark:from-slate-950 dark:via-slate-950 dark:to-indigo-950 dark:text-slate-100 lg:grid lg:grid-cols-[45%_55%]"
    >
      <aside className="relative hidden overflow-hidden border-r border-white/40 p-10 dark:border-white/5 lg:flex lg:flex-col lg:justify-center xl:p-16">
        <div aria-hidden="true" className="absolute -left-24 top-0 h-72 w-72 rounded-full bg-amber-200/40 blur-3xl dark:bg-amber-500/10" />
        <div aria-hidden="true" className="absolute -bottom-24 right-0 h-80 w-80 rounded-full bg-indigo-300/40 blur-3xl dark:bg-indigo-500/15" />
        <div className="relative mx-auto w-full max-w-xl">
          <p className="text-sm font-extrabold text-primary-600 dark:text-indigo-300">Queki</p>
          <p className="mt-3 text-4xl font-black leading-tight text-slate-950 dark:text-white xl:text-5xl">{visualTitle}</p>
          {visualCopy ? <p className="mt-4 max-w-lg text-lg leading-relaxed text-slate-600 dark:text-slate-300">{visualCopy}</p> : null}
          <div className="mt-8">{visual}</div>
        </div>
      </aside>
      <main className="flex min-h-dvh items-center px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        <div className="mx-auto w-full max-w-[500px]">
          {mobileVisual ? <div data-testid="public-auth-mobile-visual" className="mb-4 max-h-44 overflow-hidden lg:hidden">{mobileVisual}</div> : null}
          {children}
        </div>
      </main>
    </div>
  );
}
