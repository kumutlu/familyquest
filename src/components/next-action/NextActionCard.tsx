import { useStore } from '../../store/useStore';
import { useTranslation } from 'react-i18next';
import { UserPlus, Target, ListChecks, ArrowUpRight } from 'lucide-react';
import type { ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  'nextAction.inviteFamily': UserPlus,
  'nextAction.createGoal': Target,
  'nextAction.createTask': ListChecks,
  'nextAction.continueSetup': ArrowUpRight,
};

export function NextActionCard() {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const { familyMembers, savingsGoals, tasks } = useStore();

  // Determine the single most important next action for the parent.
  // `familyMembers` always includes the owner, so "no other members" means
  // the family has not been populated yet.
  let titleKey: 'nextAction.inviteFamily' | 'nextAction.createGoal' | 'nextAction.createTask' | 'nextAction.continueSetup' =
    'nextAction.continueSetup';
  let target = '/continue-setup';

  if (familyMembers.length <= 1) {
    titleKey = 'nextAction.inviteFamily';
    target = '/continue-setup';
  } else if (savingsGoals.length === 0) {
    titleKey = 'nextAction.createGoal';
    target = '/goals';
  } else if (tasks.length === 0) {
    titleKey = 'nextAction.createTask';
    target = '/tasks';
  }

  const title = t(titleKey);
  const ActionIcon = ICONS[titleKey];

  return (
    <button
      type="button"
      onClick={() => navigate(target)}
      className="flex w-full items-center gap-3 rounded-2xl border border-primary-200 bg-primary-50 p-4 text-left transition hover:bg-primary-100 focus:outline-none focus:ring-2 focus:ring-primary-300"
    >
      <ActionIcon className="h-6 w-6 shrink-0 text-primary-600" />
      <span className="text-sm font-semibold text-primary-900">{title}</span>
    </button>
  );
}
