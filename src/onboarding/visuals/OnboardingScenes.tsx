import { Check, ClipboardCheck, Gift, Heart, Home, KeyRound, Plus, Sparkles, Star } from 'lucide-react';

interface SceneProps {
  label: string;
}

const sceneBase = 'relative w-full max-w-lg motion-safe:animate-[onboarding-enter_500ms_ease-out_both] motion-reduce:animate-none';
const standardScene = `${sceneBase} h-44 sm:h-64 lg:h-80`;
const compactMobileScene = `${sceneBase} h-36 sm:h-64 lg:h-80`;

export function QuekiParentToken({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden="true" data-testid="queki-parent-token" className={`z-10 h-16 w-16 rounded-[1.4rem] border border-white/80 bg-gradient-to-br from-indigo-500 to-violet-700 shadow-xl shadow-indigo-950/20 dark:border-indigo-300/25 ${className}`}>
      <span className="absolute left-1/2 top-3 h-5 w-5 -translate-x-1/2 rounded-full bg-amber-100" />
      <span className="absolute bottom-3 left-1/2 h-5 w-9 -translate-x-1/2 rounded-t-full bg-white/90" />
      <span className="absolute -right-1 -top-1 h-4 w-4 rounded-full border-2 border-white bg-amber-400 dark:border-slate-900" />
    </div>
  );
}

export function QuekiChildToken({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden="true" data-testid="queki-child-token" className={`z-10 h-14 w-14 rounded-[1.25rem] border border-white/80 bg-gradient-to-br from-amber-400 to-orange-500 shadow-xl shadow-orange-950/15 dark:border-amber-200/25 ${className}`}>
      <span className="absolute left-1/2 top-2.5 h-4 w-4 -translate-x-1/2 rounded-full bg-rose-50" />
      <span className="absolute bottom-2.5 left-1/2 h-4 w-8 -translate-x-1/2 rounded-t-full bg-white/90" />
      <Star className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-rose-500 p-1 text-white" fill="currentColor" />
    </div>
  );
}

function QuekiFamilyToken({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`h-12 w-12 rounded-[1.1rem] border border-white/80 bg-gradient-to-br from-teal-400 to-emerald-600 shadow-lg ${className}`}>
      <span className="absolute left-1/2 top-2 h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-white/90" />
      <span className="absolute bottom-2 left-1/2 h-3.5 w-7 -translate-x-1/2 rounded-t-full bg-white/85" />
    </div>
  );
}

function QuekiHome({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`relative h-32 w-40 ${className}`}>
      <div className="absolute left-1/2 top-1 h-24 w-24 -translate-x-1/2 rotate-45 rounded-[1.75rem] bg-gradient-to-br from-indigo-500 to-violet-700 shadow-2xl shadow-indigo-500/25 dark:from-indigo-400 dark:to-violet-700" />
      <div className="absolute bottom-0 left-1/2 h-24 w-36 -translate-x-1/2 rounded-[2rem] border border-white/30 bg-gradient-to-br from-indigo-500 to-violet-700 dark:from-indigo-500 dark:to-violet-800" />
      <div className="absolute bottom-0 left-1/2 h-14 w-11 -translate-x-1/2 rounded-t-2xl bg-white/90 dark:bg-slate-900/90" />
      <Home className="absolute bottom-6 left-5 h-6 w-6 text-white/80" />
      <span className="absolute bottom-12 right-5 h-5 w-5 rounded-lg bg-amber-300 ring-4 ring-white/15" />
    </div>
  );
}

function QuekiTaskCard({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`w-32 rounded-2xl border border-white/80 bg-white/95 p-3 shadow-xl shadow-slate-900/10 dark:border-white/10 dark:bg-slate-900/95 ${className}`}>
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300">
          <ClipboardCheck className="h-4 w-4" />
        </span>
        <span className="space-y-1.5">
          <i className="block h-2 w-14 rounded-full bg-slate-700/80 dark:bg-slate-200/80" />
          <i className="block h-1.5 w-9 rounded-full bg-slate-200 dark:bg-slate-700" />
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="h-1.5 w-12 rounded-full bg-slate-100 dark:bg-slate-800" />
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">+20</span>
      </div>
    </div>
  );
}

function QuekiPointsToken({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`flex h-14 w-14 items-center justify-center rounded-full border-4 border-white bg-gradient-to-br from-amber-300 to-orange-500 text-white shadow-xl shadow-amber-500/25 dark:border-slate-900 ${className}`}>
      <Star className="h-6 w-6" fill="currentColor" />
    </div>
  );
}

function QuekiRewardProgress({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`w-36 rounded-2xl border border-rose-100 bg-white/95 p-3 shadow-xl dark:border-rose-400/15 dark:bg-slate-900/95 ${className}`}>
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-100 text-rose-500 dark:bg-rose-500/15 dark:text-rose-300">
          <Gift className="h-4 w-4" />
        </span>
        <span className="h-2 w-16 rounded-full bg-slate-700/80 dark:bg-slate-200/80" />
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
        <div className="h-full w-1/4 rounded-full bg-gradient-to-r from-rose-400 to-amber-400" />
      </div>
      <div className="mt-1 text-right text-[9px] font-bold text-slate-400">240 / 1000</div>
    </div>
  );
}

function Trail({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`border-t-2 border-dashed border-indigo-300/80 dark:border-indigo-400/40 ${className}`} />;
}

export function FamilyHomeScene({ label }: SceneProps) {
  return (
    <div role="img" aria-label={label} className={standardScene}>
      <div aria-hidden="true" className="absolute inset-x-6 bottom-3 top-4 rounded-[2.75rem] border border-white/50 bg-white/25 dark:border-white/10 dark:bg-slate-950/15" />
      <QuekiHome className="absolute bottom-7 left-1/2 -translate-x-1/2 scale-90 sm:scale-100 lg:bottom-12 lg:scale-125" />
      <QuekiParentToken className="absolute left-[5%] top-[7%] -rotate-6 lg:left-[8%] lg:top-[20%] lg:scale-110" />
      <QuekiChildToken className="absolute right-[5%] top-[10%] rotate-6 lg:right-[8%] lg:top-[25%] lg:scale-110" />
      <QuekiTaskCard className="absolute bottom-0 left-[3%] scale-75 sm:scale-90 lg:bottom-4 lg:left-[1%] lg:scale-100" />
      <QuekiPointsToken className="absolute bottom-[4%] right-[7%] scale-75 lg:right-[10%] lg:scale-100" />
      <div aria-hidden="true" className="absolute bottom-[3%] right-[28%] hidden h-12 w-12 items-center justify-center rounded-2xl bg-rose-500 text-white shadow-lg sm:flex">
        <Gift className="h-5 w-5" />
      </div>
      <Trail className="absolute left-[24%] top-[34%] w-[18%] -rotate-12" />
      <Trail className="absolute right-[23%] top-[39%] w-[17%] rotate-12" />
      <Sparkles aria-hidden="true" className="absolute left-[42%] top-[4%] h-6 w-6 text-amber-400" />
    </div>
  );
}

export function ProfileScene({ label }: SceneProps) {
  return (
    <div role="img" aria-label={label} className={standardScene}>
      <div aria-hidden="true" className="absolute left-1/2 top-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-indigo-300/70 dark:border-indigo-400/35 lg:h-56 lg:w-56" />
      <QuekiParentToken className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 scale-125 lg:scale-150" />
      <QuekiHome className="absolute bottom-1 right-[6%] scale-50 opacity-80 lg:right-[2%] lg:scale-75" />
      <div aria-hidden="true" className="absolute left-[16%] top-[18%] h-3 w-3 rounded-full bg-rose-400" />
      <Sparkles aria-hidden="true" className="absolute right-[22%] top-[14%] h-6 w-6 text-amber-400" />
    </div>
  );
}

export function ChildJoinScene({ label }: SceneProps) {
  return (
    <div role="img" aria-label={label} className={compactMobileScene}>
      <QuekiHome className="absolute bottom-1 left-1/2 -translate-x-1/2 scale-75 sm:bottom-5 sm:scale-90 lg:bottom-10 lg:scale-110" />
      <QuekiParentToken className="absolute left-[6%] top-[8%] -rotate-6 scale-90 sm:scale-100 lg:left-[12%] lg:top-[22%] lg:scale-110" />
      <QuekiChildToken className="absolute right-[6%] top-[12%] rotate-6 scale-90 motion-safe:animate-[onboarding-child-join_650ms_ease-out_both] motion-reduce:animate-none sm:scale-100 lg:right-[10%] lg:top-[28%] lg:scale-110" />
      <Trail className="absolute left-[27%] top-[38%] w-[20%] -rotate-12" />
      <Trail className="absolute right-[25%] top-[43%] w-[19%] rotate-12" />
      <Heart aria-hidden="true" className="absolute left-1/2 top-[15%] h-7 w-7 -translate-x-1/2 text-rose-400" fill="currentColor" />
    </div>
  );
}

export function FamilyMembersScene({ label }: SceneProps) {
  return (
    <div role="img" aria-label={label} className={compactMobileScene}>
      <QuekiHome className="absolute bottom-1 left-1/2 -translate-x-1/2 scale-75 opacity-90 sm:bottom-6 sm:scale-100 lg:bottom-10 lg:scale-125" />
      <svg aria-hidden="true" className="absolute inset-0 h-full w-full text-indigo-300/80 dark:text-indigo-400/35" viewBox="0 0 480 300" fill="none">
        <path d="M105 96 C155 110 170 150 205 178 M375 105 C330 115 305 150 275 178 M240 48 C240 95 240 120 240 158" stroke="currentColor" strokeWidth="2" strokeDasharray="6 8" />
      </svg>
      <QuekiParentToken className="absolute left-[5%] top-[8%] -rotate-6 scale-90 sm:left-[8%] sm:top-[13%] sm:scale-100 lg:left-[6%] lg:scale-110" />
      <QuekiChildToken className="absolute right-[5%] top-[12%] rotate-6 scale-90 sm:right-[8%] sm:top-[20%] sm:scale-100 lg:right-[6%] lg:scale-110" />
      <QuekiFamilyToken className="absolute left-1/2 top-[3%] -translate-x-1/2 rotate-3 lg:scale-110" />
      <div aria-hidden="true" data-testid="queki-add-member-token" className="absolute bottom-[6%] right-[4%] flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-dashed border-indigo-300 bg-white/65 text-indigo-500 dark:border-indigo-400/40 dark:bg-slate-900/60 dark:text-indigo-300">
        <Plus className="h-5 w-5" />
      </div>
      <Heart aria-hidden="true" className="absolute bottom-[8%] left-[7%] h-6 w-6 text-rose-400" fill="currentColor" />
    </div>
  );
}

export function JourneyScene({ label }: SceneProps) {
  return (
    <div role="img" aria-label={label} className={`${compactMobileScene} lg:max-w-xl`}>
      <div aria-hidden="true" className="absolute inset-x-2 top-1/2 h-px bg-gradient-to-r from-transparent via-indigo-300 to-transparent dark:via-indigo-500/40" />
      <div data-testid="journey-task" aria-hidden="true" className="absolute left-[1%] top-[16%] lg:left-0 lg:top-[28%]">
        <QuekiTaskCard />
      </div>
      <div data-testid="journey-approval" aria-hidden="true" className="absolute left-[39%] top-[7%] flex h-12 w-12 items-center justify-center rounded-full border-4 border-white bg-emerald-500 text-white shadow-lg dark:border-slate-900 lg:left-[34%] lg:top-[33%]">
        <Check className="h-6 w-6" strokeWidth={3} />
      </div>
      <div data-testid="journey-points" aria-hidden="true" className="absolute right-[27%] top-[36%] lg:right-[31%] lg:top-[35%]">
        <QuekiPointsToken />
      </div>
      <div data-testid="journey-reward" aria-hidden="true" className="absolute bottom-[2%] right-0 lg:bottom-auto lg:top-[27%]">
        <QuekiRewardProgress />
      </div>
      <QuekiChildToken className="absolute bottom-[2%] left-[26%] scale-75 lg:bottom-[10%] lg:left-[14%]" />
      <Trail className="absolute left-[27%] top-[39%] w-[13%] -rotate-6" />
      <Trail className="absolute right-[38%] top-[42%] w-[13%] rotate-6" />
    </div>
  );
}

export function FamilyIdentityScene({ label }: SceneProps) {
  return (
    <div role="img" aria-label={label} className={standardScene}>
      <QuekiHome className="absolute bottom-7 left-1/2 -translate-x-1/2 lg:bottom-12 lg:scale-125" />
      <QuekiParentToken className="absolute left-[13%] top-[19%] -rotate-6" />
      <QuekiChildToken className="absolute right-[13%] top-[25%] rotate-6" />
      <div aria-hidden="true" className="absolute left-1/2 top-[8%] h-10 w-36 -translate-x-1/2 rounded-xl border border-indigo-100 bg-white/90 shadow-lg dark:border-white/10 dark:bg-slate-900/90">
        <div className="mx-auto mt-3 h-2 w-20 rounded-full bg-indigo-300 dark:bg-indigo-500" />
      </div>
    </div>
  );
}

export function InvitationScene({ label }: SceneProps) {
  return (
    <div role="img" aria-label={label} className={standardScene}>
      <QuekiHome className="absolute bottom-8 left-1/2 -translate-x-1/2 lg:bottom-12 lg:scale-110" />
      <QuekiParentToken className="absolute left-[11%] top-[20%] -rotate-6" />
      <QuekiChildToken className="absolute right-[11%] top-[25%] rotate-6" />
      <div aria-hidden="true" className="absolute left-1/2 top-[7%] flex w-36 -translate-x-1/2 items-center justify-center gap-2 rounded-2xl border border-white/80 bg-white/95 p-3 text-indigo-600 shadow-xl dark:border-white/10 dark:bg-slate-900/95 dark:text-indigo-300">
        <Check className="h-4 w-4" />
        <Check className="h-4 w-4" />
        <Check className="h-4 w-4" />
      </div>
    </div>
  );
}

export function ManualJoinScene({ label }: SceneProps) {
  return (
    <div role="img" aria-label={label} className={standardScene}>
      <QuekiHome className="absolute bottom-7 right-[3%] scale-90 lg:bottom-12 lg:right-[6%] lg:scale-110" />
      <QuekiChildToken className="absolute bottom-[12%] left-[7%] -rotate-6 motion-safe:animate-[onboarding-child-join_650ms_ease-out_both] motion-reduce:animate-none lg:left-[9%] lg:scale-110" />
      <div aria-hidden="true" className="absolute left-[30%] top-[12%] flex h-28 w-40 flex-col items-center justify-center gap-3 rounded-[2rem] border border-white/80 bg-white/95 text-indigo-600 shadow-2xl shadow-indigo-950/15 dark:border-white/10 dark:bg-slate-900/95 dark:text-indigo-300 lg:left-[27%] lg:top-[18%] lg:scale-110">
        <KeyRound className="h-8 w-8" />
        <div className="flex gap-1.5">
          {[0, 1, 2, 3, 4, 5].map((dot) => (
            <span key={dot} className="h-2.5 w-2.5 rounded-full bg-indigo-300 dark:bg-indigo-500" />
          ))}
        </div>
      </div>
      <Trail className="absolute bottom-[31%] left-[19%] w-[22%] rotate-6" />
      <Trail className="absolute right-[30%] top-[40%] w-[15%] -rotate-12" />
    </div>
  );
}

export function CodeInvitationScene({ label }: SceneProps) {
  return (
    <div role="img" aria-label={label} className={standardScene}>
      <div aria-hidden="true" className="absolute left-[5%] top-[17%] flex h-24 w-36 flex-col items-center justify-center gap-2 rounded-[1.75rem] border border-white/80 bg-white/95 text-indigo-600 shadow-xl dark:border-white/10 dark:bg-slate-900/95 dark:text-indigo-300">
        <KeyRound className="h-7 w-7" />
        <div className="h-2 w-16 rounded-full bg-indigo-200 dark:bg-indigo-600" />
      </div>
      <Trail className="absolute left-[34%] top-[39%] w-[22%]" />
      <QuekiHome className="absolute bottom-7 right-[3%] scale-90 lg:bottom-12 lg:right-[5%] lg:scale-110" />
      <QuekiChildToken className="absolute bottom-[4%] left-[35%] rotate-3" />
      <div aria-hidden="true" className="absolute right-[4%] top-[10%] flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg">
        <Check className="h-5 w-5" />
      </div>
    </div>
  );
}

export function SuccessScene({ label }: SceneProps) {
  return (
    <div role="img" aria-label={label} className={`${standardScene} motion-safe:animate-[onboarding-celebrate_650ms_ease-out_both] motion-reduce:animate-none`}>
      <div aria-hidden="true" className="absolute inset-x-[12%] bottom-[3%] top-[6%] rounded-[3rem] bg-gradient-to-br from-emerald-100/80 via-white/40 to-indigo-100/70 dark:from-emerald-500/10 dark:via-slate-900/20 dark:to-indigo-500/15" />
      <QuekiHome className="absolute bottom-6 left-1/2 -translate-x-1/2 lg:bottom-10 lg:scale-125" />
      <QuekiParentToken className="absolute left-[10%] top-[24%] -rotate-6 lg:left-[8%] lg:scale-110" />
      <QuekiChildToken className="absolute right-[10%] top-[29%] rotate-6 lg:right-[8%] lg:scale-110" />
      <QuekiTaskCard className="absolute bottom-0 left-[2%] scale-75 lg:bottom-[4%] lg:scale-90" />
      <QuekiPointsToken className="absolute bottom-[2%] right-[4%] scale-75 lg:bottom-[5%] lg:scale-90" />
      <div aria-hidden="true" className="absolute left-1/2 top-[5%] flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full border-4 border-white bg-emerald-500 text-white shadow-xl dark:border-slate-900">
        <Check className="h-7 w-7" strokeWidth={3} />
      </div>
      <Sparkles aria-hidden="true" className="absolute left-[21%] top-[8%] h-7 w-7 text-amber-400" />
      <Star aria-hidden="true" className="absolute right-[20%] top-[11%] h-6 w-6 text-rose-400" fill="currentColor" />
      <Heart aria-hidden="true" className="absolute right-[32%] top-[2%] h-5 w-5 text-indigo-400" fill="currentColor" />
    </div>
  );
}
