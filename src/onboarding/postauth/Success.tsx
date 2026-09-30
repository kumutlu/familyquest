import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { OnboardingCard } from '../components/OnboardingCard';
import type { OnboardingDraft } from '../lib/onboardingDraft';

interface SuccessProps {
  draft: OnboardingDraft;
  onFinish: () => void;
}

export function Success({ draft, onFinish }: SuccessProps) {
  const { t } = useTranslation('onboarding');
  const parent = draft.parentFirstName.trim() || '—';
  const child = draft.childFirstName?.trim() || 'your child';

  const checklist = [
    t('p3.checklistChild', { child }),
    t('p3.checklistTask'),
    t('p3.checklistApp'),
  ];

  return (
    <OnboardingCard>
      <div className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[1.5rem] bg-green-100 shadow-lg shadow-emerald-500/10 dark:bg-emerald-500/15">
          <Check className="h-7 w-7 text-green-600" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-2xl font-extrabold text-gray-900 dark:text-slate-50 sm:text-3xl">{t('p3.title', { child })}</h1>
        <p className="mt-1 text-base text-gray-600 dark:text-slate-300">{t('p3.subtitle', { parent })}</p>
      </div>

      <ul className="mt-6 space-y-2" aria-label="checklist">
        {checklist.map(item => (
          <li key={item} className="flex items-center gap-3 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:bg-slate-800/70 dark:text-slate-200">
            <Check className="h-5 w-5 text-green-600 shrink-0" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-sm text-gray-500 dark:text-slate-400">{t('p3.support')}</p>

      <Button size="lg" fullWidth className="mt-6" onClick={onFinish}>
        {t('p3.cta')}
      </Button>
    </OnboardingCard>
  );
}
