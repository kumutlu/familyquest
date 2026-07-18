import { useNavigate } from 'react-router-dom';
import { Plus, Gift, Zap, Wallet, PawPrint, UserPlus } from 'lucide-react';
import { QuickActionCard } from './QuickActionCard';

export interface QuickActionsProps {
  onNewTask: () => void;
  onNewReward: () => void;
  onLogBehaviour: () => void;
}

export function QuickActions({ onNewTask, onNewReward, onLogBehaviour }: QuickActionsProps) {
  const navigate = useNavigate();

  const actions = [
    {
      key: 'task',
      label: 'New Task',
      helper: 'Assign a chore or goal',
      icon: <Plus size={20} />,
      accent: 'bg-primary-50 text-primary-600',
      onClick: onNewTask,
    },
    {
      key: 'reward',
      label: 'New Reward',
      helper: 'Add something to redeem',
      icon: <Gift size={20} />,
      accent: 'bg-reward-50 text-reward-500',
      onClick: onNewReward,
    },
    {
      key: 'behaviour',
      label: 'Log Behaviour',
      helper: 'Record good or not-so-good',
      icon: <Zap size={20} />,
      accent: 'bg-warning-50 text-warning-500',
      onClick: onLogBehaviour,
    },
    {
      key: 'money',
      label: 'Manage Wallet',
      helper: 'Add or withdraw money',
      icon: <Wallet size={20} />,
      accent: 'bg-success-50 text-success-500',
      onClick: () => navigate('/wallets'),
    },
    {
      key: 'petbox',
      label: 'Pet Box',
      helper: 'Family savings pot',
      icon: <PawPrint size={20} />,
      accent: 'bg-primary-50 text-primary-600',
      onClick: () => navigate('/pet-box'),
    },
    {
      key: 'invite',
      label: 'Invite Member',
      helper: 'Share the join code',
      icon: <UserPlus size={20} />,
      accent: 'bg-primary-50 text-primary-600',
      onClick: () => navigate('/settings'),
    },
  ];

  return (
    <section aria-labelledby="quick-actions-heading">
      <h2 id="quick-actions-heading" className="sr-only">
        Quick Actions
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {actions.map(action => (
          <QuickActionCard
            key={action.key}
            icon={action.icon}
            label={action.label}
            helper={action.helper}
            accent={action.accent}
            onClick={action.onClick}
          />
        ))}
      </div>
    </section>
  );
}
