import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { OnboardingCard } from '../components/OnboardingCard';
import { OnboardingError } from '../components/OnboardingError';
import { ensureFirstTask, type SetupDeps } from '../lib/onboardingSetup';
import { classifyOnboardingError, withBoundedTimeout, SETUP_WAIT_MS } from '../lib/onboardingErrors';
import type { OnboardingDraft } from '../lib/onboardingDraft';

interface FirstTaskProps {
  draft: OnboardingDraft;
  patch: (partial: Partial<OnboardingDraft>) => void;
  goNext: () => void;
  goBack: () => void;
  deps: SetupDeps;
}

interface TaskTemplate {
  key: 'tidy' | 'read' | 'help' | 'custom';
  title: string;
  points: number;
}

const TEMPLATES: TaskTemplate[] = [
  { key: 'tidy', title: 'Tidy bedroom', points: 20 },
  { key: 'read', title: 'Read for 20 minutes', points: 15 },
  { key: 'help', title: 'Help tidy up', points: 10 },
];

export function FirstTask({ draft, patch, goNext, goBack, deps }: FirstTaskProps) {
  const { t } = useTranslation('onboarding');
  const [selected, setSelected] = useState<string | null>(null);
  const [customTitle, setCustomTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorTitle, setErrorTitle] = useState<string | null>(null);
  const submittingRef = useRef(false);

  const childName = draft.childFirstName.trim() || 'your child';

  const handleContinue = async () => {
    // Double-click / refresh guard: never create two tasks.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    setErrorTitle(null);

    const template = TEMPLATES.find(tmpl => tmpl.key === selected);
    const title = template ? template.title : customTitle.trim();
    const points = template ? template.points : 10;
    if (!title) {
      submittingRef.current = false;
      setSubmitting(false);
      return;
    }

    try {
      const next = await withBoundedTimeout(
        ensureFirstTask(draft, deps, { title, pointsReward: points, type: 'chore', requiresApproval: true }),
        SETUP_WAIT_MS,
        t('errors.offline'),
      );
      patch({ firstTaskId: next.firstTaskId });
      goNext();
    } catch (caught: unknown) {
      setErrorTitle(t('p2.errorTitle'));
      setError(classifyOnboardingError(caught, t, 'errors.taskFailed'));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleSkip = () => {
    if (submittingRef.current) return;
    goNext();
  };

  if (error) {
    return (
      <OnboardingCard>
        <OnboardingError
          title={errorTitle ?? t('p2.title')}
          message={error ?? t('errors.taskFailed')}
          onRetry={handleContinue}
          onBack={goBack}
        />
      </OnboardingCard>
    );
  }

  return (
    <OnboardingCard>
      <h1 className="text-2xl font-extrabold text-gray-900">{t('p2.title', { child: childName })}</h1>
      <p className="mt-2 text-base text-gray-600">{t('p2.subtitle')}</p>

      <div role="radiogroup" aria-label={t('p2.title', { child: childName })} className="mt-5 space-y-2">
        {TEMPLATES.map(tmpl => (
          <button
            key={tmpl.key}
            type="button"
            role="radio"
            aria-checked={selected === tmpl.key}
            onClick={() => {
              setSelected(tmpl.key);
              setCustomTitle('');
            }}
            className={[
              'w-full min-h-[44px] rounded-xl border px-4 py-3 text-left text-base font-semibold transition-colors',
              selected === tmpl.key
                ? 'border-primary-500 bg-primary-50 text-primary-700'
                : 'border-gray-200 bg-white text-gray-700 hover:border-primary-300',
            ].join(' ')}
          >
            {t(`p2.templates.${tmpl.key}`)}
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={selected === 'custom'}
          onClick={() => setSelected('custom')}
          className={[
            'w-full min-h-[44px] rounded-xl border px-4 py-3 text-left text-base font-semibold transition-colors',
            selected === 'custom'
              ? 'border-primary-500 bg-primary-50 text-primary-700'
              : 'border-gray-200 bg-white text-gray-700 hover:border-primary-300',
          ].join(' ')}
        >
          {t('p2.templates.custom')}
        </button>
      </div>

      {selected === 'custom' ? (
        <div className="mt-3 space-y-3">
          <div>
            <label htmlFor="custom-task-title" className="block text-sm font-medium text-gray-700">
              {t('p2.customLabel')}
            </label>
            <input
              id="custom-task-title"
              type="text"
              value={customTitle}
              onChange={(event) => setCustomTitle(event.target.value)}
              className="mt-1 block w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            />
          </div>
          <div>
            <label htmlFor="custom-task-points" className="block text-sm font-medium text-gray-700">
              {t('p2.customPointsLabel')}
            </label>
            <input
              id="custom-task-points"
              type="number"
              defaultValue={10}
              min={1}
              className="mt-1 block w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            />
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 min-[400px]:flex-row min-[400px]:items-center">
        <Button variant="secondary" onClick={handleSkip} disabled={submitting}>
          {t('p2.skip')}
        </Button>
        <Button
          size="lg"
          className="flex-1"
          disabled={submitting || (!selected || (selected === 'custom' && !customTitle.trim()))}
          onClick={handleContinue}
        >
          {t('p2.continue')}
        </Button>
      </div>
    </OnboardingCard>
  );
}
