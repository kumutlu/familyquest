import { Clock3, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../components/ui/Button';
import { useStore } from '../store/useStore';

export function PendingMembership() {
  const { t } = useTranslation('family');
  const pendingMembershipStatus = useStore(state => state.pendingMembershipStatus);
  const retryBootstrap = useStore(state => state.retryBootstrap);
  const isWaiting = pendingMembershipStatus === 'pending';
  const Icon = isWaiting ? Clock3 : ShieldAlert;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-amber-50 via-white to-indigo-50 px-4 py-8 dark:from-slate-950 dark:via-slate-950 dark:to-indigo-950">
      <section className="w-full max-w-lg rounded-3xl border border-white/70 bg-white p-7 text-center shadow-xl shadow-indigo-100/40 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300" aria-hidden="true">
          <Icon size={28} />
        </span>
        <h1 className="mt-5 text-2xl font-black text-slate-950 dark:text-white">
          {t(isWaiting ? 'membershipPending.pendingTitle' : 'membershipPending.recoveryTitle')}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
          {t(isWaiting ? 'membershipPending.pendingBody' : 'membershipPending.recoveryBody')}
        </p>
        <Button className="mt-7" onClick={retryBootstrap}>
          {t(isWaiting ? 'membershipPending.pendingAction' : 'membershipPending.recoveryAction')}
        </Button>
      </section>
    </main>
  );
}

export default PendingMembership;
