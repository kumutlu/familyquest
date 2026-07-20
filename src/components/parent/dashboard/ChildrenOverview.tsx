import { useTranslation } from 'react-i18next';
import { useStore } from '../../../store/useStore';
import { isChildRole } from '../../../lib/roles';
import { isTaskDoneThisPeriod } from '../../../lib/taskRecurrence';
import { ChildSummaryCard } from './ChildSummaryCard';

function ChildCardSkeleton() {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 animate-pulse rounded-full bg-gray-200" />
        <div className="space-y-2">
          <div className="h-4 w-28 animate-pulse rounded bg-gray-200" />
          <div className="h-3 w-12 animate-pulse rounded bg-gray-100" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="h-8 animate-pulse rounded bg-gray-100" />
        <div className="h-8 animate-pulse rounded bg-gray-100" />
        <div className="h-8 animate-pulse rounded bg-gray-100" />
      </div>
    </div>
  );
}

export function ChildrenOverview() {
  const { t } = useTranslation('dashboard');
  const {
    familyMembers = [],
    childWallets = [],
    tasks = [],
    taskCompletions = [],
    bootstrapStatus,
  } = useStore();
  const walletsLoading = (bootstrapStatus as any)?.wallets === 'loading';

  const children = familyMembers.filter(member => isChildRole(member.role));

  if (children.length === 0) return null;

  return (
    <section aria-labelledby="children-overview-heading">
      <h2
        id="children-overview-heading"
        className="mb-4 flex items-center gap-2 text-lg font-bold text-gray-900"
      >
        {t('childrenOverview.heading')}
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {walletsLoading
          ? children.map(child => <ChildCardSkeleton key={child.id} />)
          : children.map(child => {
              const walletDoc = childWallets.find(w => w.id === child.id);
              // Canonical source only: families/{familyId}/wallets/{childId}.balance
              // `null` => missing canonical document => show "Unavailable", never a
              // legacy profile balance (e.g. child.walletBalance).
              const balance = walletDoc ? walletDoc.balance : null;

              const pendingTaskCount = tasks.filter(
                task =>
                  task.isActive !== false &&
                  task.assigneeId === child.id &&
                  !isTaskDoneThisPeriod(task, taskCompletions, new Date(), child.id),
              ).length;

              return (
                <ChildSummaryCard
                  key={child.id}
                  child={child}
                  walletBalance={balance}
                  pendingTaskCount={pendingTaskCount}
                />
              );
            })}
      </div>
    </section>
  );
}
