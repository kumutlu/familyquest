import { useStore } from '../../store/useStore';
import { useTranslation } from 'react-i18next';
import { UserPlus, ListChecks, ArrowUpRight, Bell, Gift, CheckCircle2 } from 'lucide-react';
import type { ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  'nextAction.inviteFamily': UserPlus,
  'nextAction.createReward': Gift,
  'nextAction.createTask': ListChecks,
  'nextAction.continueSetup': ArrowUpRight,
  'nextAction.reviewJoinRequests': Bell,
  'nextAction.allSet': CheckCircle2,
};

export function NextActionCard() {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const { familyMembers, rewards, tasks, joinRequests, currentUser } = useStore();

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
