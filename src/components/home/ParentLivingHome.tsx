import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Cat, ChevronRight, ClipboardCheck, Target, Swords, Wallet, Sparkles, AlertTriangle, RefreshCw } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { ApprovalCenter } from '../parent/ApprovalCenter';
import { selectParentPriorities, type ParentPriority } from '../../lib/home/priorities';
import { getFocusModeState } from '../../lib/focusMode';
import { FocusModeDashboard } from '../parent/dashboard/FocusModeDashboard';
import { AddChildModal } from '../family/AddChildModal';
import { formatMoney } from '../../lib/walletPresentation';
import { isPetBoxEnabled } from '../../lib/familyFeatures';
import { Surface } from '../queki/Surface';
import { TactileCard } from '../queki/TactileCard';
import { LivingHomeCard } from '../queki/LivingHomeCard';
import { CharacterFrame } from '../queki/CharacterFrame';
import { QuekiMascot } from '../queki/QuekiMascot';
import { BalanceChip } from '../queki/semanticDisplays';
import { StatusBadge } from '../queki/StatusBadge';
import { BottomSheet } from '../queki/BottomSheet';
import { TactileButton } from '../queki/TactileButton';

/**
 * Parent Living Home — Queki v2 Wave 1.
 *
 * Answers "what matters right now?" via the deterministic priority selector
 * (src/lib/home/priorities.ts). Deliberately does NOT render the activity
 * feed, reversal history or the full Approval Center inline: approvals open in
 * a sheet backed by the existing ApprovalCenter component so no functionality
 * is lost ahead of the Wave 2 Swipe Review flow.
 */

const PRIORITY_TESTID: Record<ParentPriority['kind'], string> = {
  approvals: 'priority-approvals',
  goal_milestone: 'priority-goal-milestone',
  challenge_update: 'priority-challenge',
  wallet_event: 'priority-wallet-event',
};

export function ParentLivingHome() {
  const { t } = useTranslation('home');
  const navigate = useNavigate();
  const {
    currentUser,
    familyMembers,
    familyData,
    myWallet,
    childWallets,
    funds,
    tasks,
    rewards,
    taskCompletions,
    transferRequests,
    moneyRequests,
    petboxRequests,
    profileUpdateRequests,
    goalRequests,
    childJoinRequests,
    savingsGoals,
    challenges,
    walletTransactions,
    bootstrapStatus,
    retryFeature,
  } = useStore();

  const [approvalsOpen, setApprovalsOpen] = useState(false);
  const [isAddChildOpen, setIsAddChildOpen] = useState(false);

  const children = useMemo(() => familyMembers.filter(m => m?.role === 'child'), [familyMembers]);
  const isSingleChild = children.length === 1;
  const canAccessPetBox = isPetBoxEnabled(familyData);

  const activeGoal = useMemo(() => {
    if (!Array.isArray(savingsGoals)) return undefined;
    return savingsGoals
      .filter(goal => goal?.status === 'active' && Number(goal?.targetAmountPence) > 0)
      .map(goal => ({
        ...goal,
        progress: Math.min(100, Math.max(0, Math.round((Number(goal.currentAmountPence ?? 0) / Number(goal.targetAmountPence)) * 100))),
      }))
      .sort((a, b) => b.progress - a.progress)[0] ?? null;
  }, [savingsGoals]);
  const childWalletTotal = useMemo(
    () => Array.isArray(childWallets)
      ? childWallets.reduce((sum, wallet) => sum + Number(wallet?.balance ?? 0), 0)
      : undefined,
    [childWallets],
  );
  const catBoxTotal = useMemo(
    () => Array.isArray(funds)
      ? funds.reduce((sum, fund) => sum + Number(fund?.balance ?? 0), 0)
      : undefined,
    [funds],
  );

  const priorities = useMemo(
    () =>
      selectParentPriorities({
        taskCompletions,
        transferRequests,
        moneyRequests,
        petboxRequests,
        profileUpdateRequests,
        goalRequests,
        childJoinRequests,
        savingsGoals,
        challenges,
        walletTransactions,
        familyMembers,
        petBoxEnabled: true,
      }),
    [taskCompletions, transferRequests, moneyRequests, petboxRequests, profileUpdateRequests, goalRequests, childJoinRequests, savingsGoals, challenges, walletTransactions, familyMembers],
  );

  const approvalsCount = priorities.find(p => p.kind === 'approvals')?.count ?? 0;
  const mascotState = approvalsCount > 0 ? 'attention' : 'happy';

  // Structured loading skeleton while the resources priority cards depend on
  // are still hydrating — never an indefinite spinner.
  const resourcesLoading =
    !bootstrapStatus ||
    (['members', 'tasks'] as const).some(
      resource => bootstrapStatus[resource] === 'loading' || bootstrapStatus[resource] === 'idle',
    );

  // Focus Mode: while family setup is incomplete, suppress every non-essential
  // section and show the single guided next action instead (preserved from the
  // previous dashboard experience).
  const focus = getFocusModeState({ familyMembers, rewards, tasks, joinRequests: [], currentUser });
  if (focus.isFocusMode) {
    return (
      <div data-testid="dashboard-focus-mode">
        <FocusModeDashboard onAddChild={() => setIsAddChildOpen(true)} />
        {isAddChildOpen && (
          <AddChildModal familyId={currentUser.familyId} onClose={() => setIsAddChildOpen(false)} />
        )}
      </div>
    );
  }

  const renderPriority = (priority: ParentPriority) => {
    switch (priority.kind) {
      case 'approvals':
        return (
          <LivingHomeCard
            key={priority.id}
            data-testid={PRIORITY_TESTID[priority.kind]}
            tone="coral"
            icon={<ClipboardCheck size={22} />}
            title={t('parent.approvals.title', { count: priority.count ?? 0 })}
            description={t('parent.approvals.description')}
            trailing={
              <TactileButton
                size="sm"
                variant="coral"
                data-testid="review-cta"
                onClick={() => navigate('/review')}
              >
                {t('parent.approvals.action')}
              </TactileButton>
            }
          />
        );
      case 'goal_milestone':
        return (
          <LivingHomeCard
            key={priority.id}
            data-testid={PRIORITY_TESTID[priority.kind]}
            tone="mint"
            icon={<Target size={22} />}
            title={t('parent.goalMilestone.title', { title: priority.goalTitle, progress: priority.progressPct })}
            description={t('parent.goalMilestone.description')}
            onPress={() => navigate('/goals')}
          />
        );
      case 'challenge_update':
        return (
          <LivingHomeCard
            key={priority.id}
            data-testid={PRIORITY_TESTID[priority.kind]}
            tone="family"
            icon={<Swords size={22} />}
            title={t('parent.challengeUpdate.title')}
            description={t('parent.challengeUpdate.description', { title: priority.challengeTitle })}
            onPress={() => navigate('/tasks')}
          />
        );
      case 'wallet_event':
        return (
          <LivingHomeCard
            key={priority.id}
            data-testid={PRIORITY_TESTID[priority.kind]}
            tone="mint"
            icon={<Wallet size={22} />}
            title={t('parent.walletEvent.title', {
              name: priority.memberName ?? t('family:memberFallback', { defaultValue: 'A family member' }),
              amount: formatMoney(priority.amountPence ?? 0),
            })}
            description={t('parent.walletEvent.description')}
            onPress={() => navigate('/wallets')}
          />
        );
    }
  };

  const coreResourcesFailed =
    bootstrapStatus &&
    (['tasks', 'members'] as const).some(resource => bootstrapStatus[resource] === 'error');

  if (coreResourcesFailed) {
    return (
      <div className="mx-auto max-w-md py-12 text-center" role="alert" data-testid="living-home-error">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-coral-50 text-coral-500">
          <AlertTriangle size={26} aria-hidden="true" />
        </span>
        <h2 className="text-card-title qk-text-primary">{t('errorTitle')}</h2>
        <p className="mt-1 text-body qk-text-secondary">{t('errorDescription')}</p>
        <TactileButton
          className="mt-5"
          onClick={() => retryFeature('members')}
          data-testid="living-home-retry"
        >
          <RefreshCw size={16} aria-hidden="true" />
          {t('errorRetry')}
        </TactileButton>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8" data-testid="parent-living-home">
      {/* ---- Hero ---------------------------------------------------------- */}
      <Surface
        level="card"
        className="relative overflow-hidden rounded-hero p-6 text-white"
        style={{ background: 'linear-gradient(135deg, var(--qk-surface-hero-from), var(--qk-surface-hero-to))' }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-title">{t('parent.greeting', { name: currentUser?.displayName ?? '' })}</h1>
            <p className="mt-1 text-body opacity-80">{t('parent.heroSubtitle')}</p>
            {familyData?.name && (
              <p className="mt-2 inline-flex rounded-full bg-white/15 px-3 py-1 text-meta font-semibold">
                {familyData.name}
              </p>
            )}
          </div>
          <QuekiMascot state={mascotState} size={84} className="-mt-1 shrink-0 drop-shadow-lg" />
        </div>

        {/* Family wallet aggregate — real money keeps its mint identity even on brand gradient. */}
        <Link
          to="/wallets"
          aria-label={t('parent.openFamilyWallets', { defaultValue: 'Open Family Wallets' })}
          className="group mt-4 flex cursor-pointer items-center gap-3 rounded-2xl p-2 -m-2 transition-colors hover:bg-white/10 active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
        >
          <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15">
            <Wallet size={18} />
          </span>
          <div>
            <p className="text-meta font-semibold uppercase tracking-wide opacity-75">
              {t('parent.familyBalanceLabel')}
            </p>
            <p className="font-balance tabular-nums" data-testid="parent-family-balance">
              {formatMoney(
                (myWallet?.balance ?? 0) +
                  (childWallets ?? []).reduce((sum: number, wallet: any) => sum + Number(wallet?.balance ?? 0), 0),
              )}
            </p>
          </div>
          <ChevronRight
            size={20}
            aria-hidden="true"
            className="ml-auto opacity-70 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100"
          />
        </Link>
      </Surface>

      {/* ---- Priority cards (max 3, deterministic) -------------------------- */}
      <section aria-label={t('parent.heroSubtitle')} className="space-y-3">
        {resourcesLoading ? (
          <>
            <div className="h-20 animate-pulse rounded-card qk-bg-inset" aria-hidden="true" />
            <div className="h-20 animate-pulse rounded-card qk-bg-inset" aria-hidden="true" />
          </>
        ) : priorities.length > 0 ? (
          priorities.map(renderPriority)
        ) : (
          <TactileCard className="flex items-center gap-4 p-4" data-testid="parent-all-calm">
            <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-500">
              <Sparkles size={22} />
            </span>
            <div>
              <p className="text-card-title qk-text-primary">{t('parent.allCalm.title')}</p>
              <p className="mt-0.5 text-meta qk-text-secondary">{t('parent.allCalm.description')}</p>
            </div>
          </TactileCard>
        )}
      </section>

      {/* ---- Children overview (family-size adaptive) ----------------------- */}
      {children.length > 0 && (
        <section aria-label={t('parent.childrenHeading')}>
          <h2 className="mb-3 text-card-title qk-text-primary">{t('parent.childrenHeading')}</h2>
          {isSingleChild ? (
            <SingleChildOverview child={children[0]} />
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2" data-testid="children-overview-multi">
              {children.map(child => (
                <TactileCard
                  key={child.id}
                  onPress={() => navigate(`/family/${child.id}`)}
                  className="flex min-w-36 flex-col items-center gap-2 p-4"
                >
                  <CharacterFrame src={child.avatarUrl} fallback={child.displayName} size={56} ringColor={child.colour} />
                  <p className="text-body font-bold qk-text-primary">{child.displayName}</p>
                  <StatusBadge tone="xp">Lv {child.level ?? 1}</StatusBadge>
                </TactileCard>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ---- First-class family tools ------------------------------------- */}
      <section aria-labelledby="family-tools-heading" data-testid="parent-family-tools">
        <h2 id="family-tools-heading" className="mb-3 text-card-title qk-text-primary">{t('parent.familyTools.heading')}</h2>
        <div data-testid="family-tools-layout" className={`grid grid-cols-1 gap-3 ${canAccessPetBox ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
          <TactileCard tone="brand" onPress={() => navigate('/goals')} aria-label={t('parent.familyTools.openGoals')} data-testid="family-tools-goals" className="min-h-44 w-full overflow-hidden p-5">
            <FamilyToolIcon tone="brand"><Target size={26} /></FamilyToolIcon>
            <p className="mt-4 text-card-title qk-text-primary">{t('parent.familyTools.goalsTitle')}</p>
            {activeGoal === undefined ? <p className="mt-2 text-body qk-text-secondary">{t('parent.familyTools.unavailable')}</p>
              : activeGoal === null ? <p className="mt-2 text-body qk-text-secondary">{t('parent.familyTools.noActiveGoals')}</p>
              : <>
                  <p className="mt-2 text-body font-bold text-primary-600">{t('parent.familyTools.closestGoal', { percent: activeGoal.progress })}</p>
                  <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={activeGoal.progress} aria-label={t('parent.familyTools.goalProgress', { percent: activeGoal.progress })} className="mt-3 h-2 overflow-hidden rounded-full qk-bg-inset">
                    <div className="h-full rounded-full bg-primary-500" style={{ width: `${activeGoal.progress}%` }} />
                  </div>
                </>}
          </TactileCard>
          <TactileCard tone="mint" onPress={() => navigate('/wallets')} aria-label={t('parent.familyTools.openWallets')} data-testid="family-tools-wallets" className="min-h-44 w-full overflow-hidden p-5">
            <FamilyToolIcon tone="mint"><Wallet size={26} /></FamilyToolIcon>
            <p className="mt-4 text-card-title qk-text-primary">{t(isSingleChild ? 'parent.familyTools.walletTitle' : 'parent.familyTools.walletsTitle')}</p>
            {childWalletTotal === undefined ? <p className="mt-2 text-body qk-text-secondary">{t('parent.familyTools.unavailable')}</p>
              : childWallets.length === 0 ? <p className="mt-2 text-body qk-text-secondary">{t('parent.familyTools.noChildWallets')}</p>
              : <>
                  <p className="mt-2 font-balance tabular-nums text-mint-700">{formatMoney(childWalletTotal)}</p>
                  <p className="text-meta font-semibold qk-text-secondary">{t('parent.familyTools.totalChildBalance')}</p>
                </>}
          </TactileCard>
          {canAccessPetBox && (
            <TactileCard tone="streak" onPress={() => navigate('/pet-box')} aria-label={t('parent.familyTools.openPetBox')} data-testid="family-tools-cat-box" className="min-h-44 w-full overflow-hidden p-5">
              <FamilyToolIcon tone="amber"><Cat size={26} /></FamilyToolIcon>
              <p className="mt-4 text-card-title qk-text-primary">{t('parent.familyTools.petBoxTitle')}</p>
              {catBoxTotal === undefined ? <p className="mt-2 text-body qk-text-secondary">{t('parent.familyTools.unavailable')}</p>
                : funds.length === 0 ? <p className="mt-2 text-body qk-text-secondary">{t('parent.familyTools.noActiveFunds')}</p>
                : <p className="mt-2 text-body font-bold text-streak-600">{t('parent.familyTools.saved', { amount: formatMoney(catBoxTotal) })}</p>}
            </TactileCard>
          )}
        </div>
      </section>

      {/* ---- Detailed approval history (legacy Approval Center, preserved) --- */}
      <div className="flex justify-end">
        <button
          type="button"
          data-testid="approval-history-link"
          onClick={() => setApprovalsOpen(true)}
          className="rounded-full px-3 py-1.5 text-meta font-bold text-primary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          {t('parent.historyLink')}
        </button>
      </div>

      {/* ---- Approvals sheet (existing Approval Center, preserved) ---------- */}
      <ApprovalsSheet open={approvalsOpen} onClose={() => setApprovalsOpen(false)} />
    </div>
  );
}

function FamilyToolIcon({ children, tone }: { children: React.ReactNode; tone: 'brand' | 'mint' | 'amber' }) {
  const colours = {
    brand: 'bg-primary-50 text-primary-600',
    mint: 'bg-mint-50 text-mint-700',
    amber: 'bg-streak-50 text-streak-600',
  };
  return <span aria-hidden="true" className={`flex h-12 w-12 items-center justify-center rounded-2xl ${colours[tone]}`}>{children}</span>;
}

function SingleChildOverview({ child }: { child: any }) {
  const { t } = useTranslation('home');
  const navigate = useNavigate();
  return (
    <TactileCard
      onPress={() => navigate(`/family/${child.id}`)}
      className="flex items-center gap-4 p-4"
      data-testid="children-overview-single"
    >
      <CharacterFrame src={child.avatarUrl} fallback={child.displayName} size={64} ringColor={child.colour} hero />
      <div className="min-w-0 flex-1">
        <p className="text-card-title qk-text-primary">{child.displayName}</p>
        <p className="mt-0.5 text-meta qk-text-secondary">
          {t('parent.childSubtitle', { level: child.level ?? 1, points: child.rewardPoints ?? 0 })}
        </p>
      </div>
      <BalanceChip balancePence={Number(child.walletBalancePence ?? 0)} />
    </TactileCard>
  );
}

/**
 * The full Approval Center (pending + history tabs) stays fully functional but
 * lives behind a sheet — Home only ever shows the compact summary card.
 */
function ApprovalsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('home');
  return (
    <BottomSheet open={open} onClose={onClose} aria-label={t('parent.reviewSheetTitle')} title={t('parent.reviewSheetTitle')}>
      <ApprovalCenter />
    </BottomSheet>
  );
}
