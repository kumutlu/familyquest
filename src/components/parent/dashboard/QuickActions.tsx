import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Gift, Zap, Wallet, PawPrint, UserPlus } from 'lucide-react';
import { QuickActionCard } from './QuickActionCard';

export interface QuickActionsProps {
  onAddChild: () => void;
  onNewTask: () => void;
  onNewReward: () => void;
  onLogBehaviour: () => void;
  petBoxEnabled?: boolean;
}

export function QuickActions({ onAddChild, onNewTask, onNewReward, onLogBehaviour, petBoxEnabled = true }: QuickActionsProps) {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();

  const actions = [
    {
      key: 'child',
      label: t('quickActions.addChild'),
      helper: t('quickActions.addChildHelper'),
      icon: <UserPlus size={20} />,
      accent: 'bg-primary-50 text-primary-600',
      onClick: onAddChild,
    },
    {
      key: 'task',
      label: t('quickActions.newTask'),
      helper: t('quickActions.newTaskHelper'),
      icon: <Plus size={20} />,
      accent: 'bg-primary-50 text-primary-600',
      onClick: onNewTask,
    },
    {
      key: 'reward',
      label: t('quickActions.newReward'),
      helper: t('quickActions.newRewardHelper'),
      icon: <Gift size={20} />,
      accent: 'bg-reward-50 text-reward-500',
      onClick: onNewReward,
    },
    {
      key: 'behaviour',
      label: t('quickActions.logBehaviour'),
      helper: t('quickActions.logBehaviourHelper'),
      icon: <Zap size={20} />,
      accent: 'bg-warning-50 text-warning-500',
      onClick: onLogBehaviour,
    },
    {
      key: 'money',
      label: t('quickActions.manageWallet'),
      helper: t('quickActions.manageWalletHelper'),
      icon: <Wallet size={20} />,
      accent: 'bg-success-50 text-success-500',
      onClick: () => navigate('/wallets'),
    },
    ...(petBoxEnabled ? [{
      key: 'petbox',
      label: t('quickActions.petBox'),
      helper: t('quickActions.petBoxHelper'),
      icon: <PawPrint size={20} />,
      accent: 'bg-primary-50 text-primary-600',
      onClick: () => navigate('/pet-box'),
    }] : []),
    {
      key: 'invite',
      label: t('quickActions.inviteMember'),
      helper: t('quickActions.inviteMemberHelper'),
      icon: <UserPlus size={20} />,
      accent: 'bg-primary-50 text-primary-600',
      onClick: () => navigate('/settings'),
    },
  ];

  return (
    <section aria-labelledby="quick-actions-heading">
      <h2 id="quick-actions-heading" className="sr-only">
        {t('quickActions.heading')}
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
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
