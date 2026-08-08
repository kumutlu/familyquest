import { useStore } from '../../store/useStore';
import { useTranslation } from 'react-i18next';
import { UserPlus, ListChecks, ArrowUpRight, Bell, Gift, CheckCircle2, Clock, MailCheck } from 'lucide-react';
import type { ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/Button';
import { InviteMemberCard } from '../dashboard/InviteMemberCard';
import { getFocusModeState, type FocusStepKey } from '../../lib/focusMode';

const FOCUS_ICONS: Record<FocusStepKey, ComponentType<{ className?: string }>> = {
  addChild: UserPlus,
  pendingInvite: MailCheck,
  createReward: Gift,
  createTask: ListChecks,
};

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  'nextAction.inviteFamily': UserPlus,
  'nextAction.createReward': Gift,
  'nextAction.createTask': ListChecks,
  'nextAction.continueSetup': ArrowUpRight,
  'nextAction.reviewJoinRequests': Bell,
  'nextAction.allSet': CheckCircle2,
};

export interface NextActionCardProps {
  /**
   * `compact` (default) keeps the original inline dashboard row.
   * `focus` renders the large guided Focus Mode card with exactly one
   * primary CTA. Both variants share the same underlying state machine so we
   * never build a parallel onboarding system.
   */
  variant?: 'compact' | 'focus';
  /** Opens the existing Add Child modal instead of navigating away. */
  onAddChild?: () => void;
}

export function NextActionCard({ variant = 'compact', onAddChild }: NextActionCardProps = {}) {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const { familyMembers = [], rewards = [], tasks = [], joinRequests = [], currentUser = null } = useStore();

  if (variant === 'focus') {
    const focus = getFocusModeState({ familyMembers, rewards, tasks, joinRequests, currentUser });
    if (!focus.step) return null;

    const step = focus.step;
    const StepIcon = FOCUS_ICONS[step];
    const base = `focus.steps.${step}` as const;

    // `pendingInvite` intentionally has no primary CTA: the parent is waiting,
    // so only secondary copy/share actions are offered.
    const primary: { label: string; onClick: () => void } | null =
      step === 'addChild'
        ? {
          label: t('focus.steps.addChild.cta'),
          onClick: () => (onAddChild ? onAddChild() : navigate('/family')),
        }
        : step === 'createReward'
          ? { label: t('focus.steps.createReward.cta'), onClick: () => navigate('/rewards') }
          : step === 'createTask'
            ? { label: t('focus.steps.createTask.cta'), onClick: () => navigate('/tasks') }
            : null;

    return (
      <section
        aria-labelledby="focus-next-action-title"
        className="rounded-2xl border border-primary-200 bg-primary-50 p-6"
      >
        <div className="flex items-start gap-4">
          <StepIcon className="mt-1 h-7 w-7 shrink-0 text-primary-600" aria-hidden="true" />
          <div className="flex-1">
            <h2 id="focus-next-action-title" className="text-xl font-bold text-primary-900">
              {t(`${base}.title`)}
            </h2>
            <p className="mt-1 text-sm text-primary-800">{t(`${base}.description`)}</p>
            <p className="mt-2 flex items-center gap-1 text-xs font-medium text-primary-700">
              <Clock size={14} aria-hidden="true" />
              {t(`${base}.duration`)}
            </p>
          </div>
        </div>

        {primary && (
          <Button fullWidth className="mt-5" onClick={primary.onClick}>
            {primary.label}
          </Button>
        )}

        {step === 'pendingInvite' && (
          <div className="mt-5">
            <InviteMemberCard />
          </div>
        )}
      </section>
    );
  }

  // Determine the single most important next action for the parent.
  // `familyMembers` always includes the owner, so "no other members" means
  // the family has not been populated yet.
  const isOwnerOrParent = currentUser?.role === 'owner' || currentUser?.role === 'parent';
  const hasPendingJoin = isOwnerOrParent && joinRequests.some(request => request.status === 'pending');

  let titleKey: 'nextAction.inviteFamily' | 'nextAction.createReward' | 'nextAction.createTask' | 'nextAction.continueSetup' | 'nextAction.reviewJoinRequests' | 'nextAction.allSet' =
    'nextAction.allSet';
  let target: string | null = null;
  let asButton = false;

  if (hasPendingJoin) {
    titleKey = 'nextAction.reviewJoinRequests';
    target = '/';
    asButton = true;
  } else if (familyMembers.length <= 1) {
    titleKey = 'nextAction.inviteFamily';
    target = '/continue-setup';
    asButton = true;
  } else if (rewards.length === 0) {
    titleKey = 'nextAction.createReward';
    target = '/rewards';
    asButton = true;
  } else if (tasks.length === 0) {
    titleKey = 'nextAction.createTask';
    target = '/tasks';
    asButton = true;
  }

  const title = t(titleKey);
  const ActionIcon = ICONS[titleKey];

  if (!asButton) {
    return (
      <div className="flex w-full items-center gap-3 rounded-2xl border border-green-200 bg-green-50 p-4 text-left">
        <ActionIcon className="h-6 w-6 shrink-0 text-green-600" />
        <span className="text-sm font-semibold text-green-900">{title}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => navigate(target as string)}
      className="flex w-full items-center gap-3 rounded-2xl border border-primary-200 bg-primary-50 p-4 text-left transition hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-300"
    >
      <ActionIcon className="h-6 w-6 shrink-0 text-primary-600" />
      <span className="text-sm font-semibold text-primary-900">{title}</span>
    </button>
  );
}
