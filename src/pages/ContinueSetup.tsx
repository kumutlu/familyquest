import { useTranslation } from 'react-i18next';
import { useStore } from '../store/useStore';
import { useNavigate } from 'react-router-dom';
import { Users, Gift, CheckSquare, CheckCircle, Circle } from 'lucide-react';
import type { ComponentType } from 'react';
import { Button } from '../components/ui/Button';
import { InviteMemberCard } from '../components/dashboard/InviteMemberCard';

type StepKey = 'inviteFamily' | 'createReward' | 'createTask';

interface SetupStep {
  key: StepKey;
  done: boolean;
  icon: ComponentType<{ size?: number; className?: string }>;
  action: () => void;
}

export function ContinueSetup() {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const { familyMembers = [], rewards = [], tasks = [] } = useStore(s => s);

  const hasFamily = familyMembers.length > 1;
  const hasRewards = rewards.length > 0;
  const hasTasks = tasks.length > 0;
  const allDone = hasFamily && hasRewards && hasTasks;

  const steps: SetupStep[] = [
    { key: 'inviteFamily', done: hasFamily, icon: Users, action: () => navigate('/') },
    { key: 'createReward', done: hasRewards, icon: Gift, action: () => navigate('/rewards') },
    { key: 'createTask', done: hasTasks, icon: CheckSquare, action: () => navigate('/tasks') },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">{t('nextAction.continueSetup')}</h1>
        <p className="mt-1 text-gray-500">
          {allDone ? t('continueSetup.allDone') : t('continueSetup.inProgress')}
        </p>
      </header>

      <ol className="space-y-3">
        {steps.map(step => {
          const StepIcon = step.icon;
          return (
            <li key={step.key}>
              <div className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white p-4">
                <StepIcon size={20} className="shrink-0 text-primary-600" />
                <span className="flex-1 text-sm font-medium text-gray-900">
                  {t(`nextAction.${step.key}`)}
                </span>
                {step.done ? (
                  <CheckCircle size={20} className="shrink-0 text-green-500" />
                ) : (
                  <Circle size={20} className="shrink-0 text-gray-300" />
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {!hasFamily && <InviteMemberCard onAddChild={() => navigate('/')} />}
      {!hasRewards && (
        <Button fullWidth onClick={() => navigate('/rewards')}>
          {t('nextAction.createReward')}
        </Button>
      )}
      {!hasTasks && (
        <Button fullWidth onClick={() => navigate('/tasks')}>
          {t('nextAction.createTask')}
        </Button>
      )}
    </div>
  );
}
