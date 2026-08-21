import {
  Award,
  Check,
  ClipboardCheck,
  Gift,
  Heart,
  Home,
  KeyRound,
  Sparkles,
  Star,
  UserRound,
  UsersRound,
} from 'lucide-react';

interface SceneProps {
  label: string;
}

const token = 'flex items-center justify-center rounded-2xl border border-white/70 bg-white/85 text-primary-600 shadow-lg shadow-indigo-950/10 backdrop-blur dark:border-white/10 dark:bg-slate-900/85 dark:text-indigo-300';

export function FamilyHomeScene({ label }: SceneProps) {
  return (
    <div role="img" aria-label={label} className="relative h-56 w-full max-w-sm motion-safe:animate-[onboarding-enter_500ms_ease-out_both] motion-reduce:animate-none">
      <div className="absolute inset-x-10 bottom-2 h-36 rounded-[2.5rem] bg-gradient-to-br from-indigo-500 to-violet-600 shadow-2xl shadow-indigo-500/25 dark:from-indigo-500 dark:to-violet-800">
        <Home className="absolute left-1/2 top-8 h-16 w-16 -translate-x-1/2 text-white" strokeWidth={1.7} />
        <div className="absolute inset-x-8 bottom-5 h-3 rounded-full bg-white/20" />
      </div>
      <div className={`${token} absolute left-3 top-10 h-16 w-16 -rotate-6`}><UserRound className="h-7 w-7" /></div>
      <div className={`${token} absolute right-3 top-5 h-16 w-16 rotate-6`}><Heart className="h-7 w-7 text-rose-500 dark:text-rose-300" /></div>
      <div className={`${token} absolute right-8 bottom-3 h-14 w-14 rotate-3`}><Star className="h-6 w-6 text-amber-500" /></div>
    </div>
  );
}

export function ProfileScene({ label }: SceneProps) {
  return (
    <div role="img" aria-label={label} className="relative flex h-52 w-full items-center justify-center">
      <div className={`${token} h-28 w-28 rounded-[2rem]`}><UserRound className="h-12 w-12" /></div>
      <div className="absolute bottom-6 right-[18%] flex h-14 w-14 items-center justify-center rounded-full bg-amber-400 text-white shadow-lg dark:bg-amber-500"><Sparkles className="h-6 w-6" /></div>
      <div aria-hidden="true" className="absolute left-[18%] top-6 h-4 w-4 rounded-full bg-rose-300 dark:bg-rose-400/70" />
    </div>
  );
}

export function FamilyMembersScene({ label }: SceneProps) {
  return (
    <div role="img" aria-label={label} className="relative flex h-52 w-full items-center justify-center">
      <div className="absolute h-32 w-32 rounded-full border-2 border-dashed border-indigo-300 dark:border-indigo-500/50" />
      <div className={`${token} z-10 h-28 w-28 rounded-[2rem]`}><UsersRound className="h-12 w-12" /></div>
      <div className={`${token} absolute left-[15%] top-7 h-14 w-14 -rotate-6`}><UserRound className="h-6 w-6" /></div>
      <div className={`${token} absolute bottom-5 right-[14%] h-14 w-14 rotate-6`}><Heart className="h-6 w-6 text-rose-500 dark:text-rose-300" /></div>
    </div>
  );
}

export function JourneyScene({ label }: SceneProps) {
  const nodes = [
    { icon: ClipboardCheck, tone: 'bg-indigo-500', key: 'task' },
    { icon: Check, tone: 'bg-emerald-500', key: 'approval' },
    { icon: Star, tone: 'bg-amber-500', key: 'points' },
    { icon: Gift, tone: 'bg-rose-500', key: 'reward' },
  ];
  return (
    <div role="img" aria-label={label} className="flex w-full max-w-sm items-center justify-center gap-2">
      {nodes.map(({ icon: Icon, tone, key }, index) => (
        <div key={key} className="contents">
          <div className={`flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg ${tone}`}>
            <Icon className="h-6 w-6" />
          </div>
          {index < nodes.length - 1 ? <div className="h-0.5 min-w-3 flex-1 rounded-full bg-indigo-200 dark:bg-indigo-700" /> : null}
        </div>
      ))}
    </div>
  );
}

export function InvitationScene({ label }: SceneProps) {
  return (
    <div role="img" aria-label={label} className="relative flex h-52 w-full items-center justify-center">
      <div className={`${token} h-32 w-52 flex-col gap-3 rounded-[2rem]`}>
        <KeyRound className="h-9 w-9" />
        <div className="flex gap-2">
          {[0, 1, 2, 3, 4, 5].map(dot => <span key={dot} className="h-2.5 w-2.5 rounded-full bg-indigo-300 dark:bg-indigo-500" />)}
        </div>
      </div>
      <div className="absolute right-[11%] top-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-500 text-white shadow-lg"><Heart className="h-6 w-6" /></div>
    </div>
  );
}

export function SuccessScene({ label }: SceneProps) {
  return (
    <div role="img" aria-label={label} className="relative flex h-56 w-full items-center justify-center">
      <div className="flex h-36 w-36 items-center justify-center rounded-[2.75rem] bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-2xl shadow-emerald-500/25 motion-safe:animate-[onboarding-celebrate_600ms_ease-out_both] motion-reduce:animate-none">
        <Award className="h-16 w-16" strokeWidth={1.7} />
      </div>
      <Sparkles className="absolute left-[15%] top-8 h-8 w-8 text-amber-500" />
      <Star className="absolute right-[16%] top-4 h-7 w-7 text-rose-500" />
      <Heart className="absolute bottom-5 right-[18%] h-7 w-7 text-indigo-500 dark:text-indigo-300" />
    </div>
  );
}
