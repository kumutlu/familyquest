import { useTranslation } from 'react-i18next';

interface MiniJourneyProps {
  childName: string;
}

/**
 * Presentational, reduced-motion-safe demo of the core loop. The mental model
 * (Task → child completes → you approve → points → reward) is conveyed entirely
 * by text + static cards, so it is fully understandable with motion disabled.
 * Animations are decorative only and gated by `motion-reduce`.
 */
export function MiniJourney({ childName }: MiniJourneyProps) {
  const { t } = useTranslation('onboarding');
  const child = childName.trim() || 'your child';

  const steps = [
    { text: t('s5.step1', { child }), card: t('s5.step1Card') },
    { text: t('s5.step2', { child }), card: t('s5.step2Card') },
    { text: t('s5.step3'), card: t('s5.step4Card') },
  ];

  return (
    <div className="space-y-3">
      {steps.map((step, index) => (
        <div
          key={index}
          className="flex items-center gap-3 rounded-xl bg-gray-50 px-3 py-3 motion-reduce:transition-none motion-safe:transition-all motion-safe:duration-500"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-100 text-sm font-bold text-primary-700">
            {index + 1}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800">{step.text}</p>
            <p className="text-xs text-gray-500">{step.card}</p>
          </div>
        </div>
      ))}

      <p className="text-sm font-medium text-gray-700">{t('s5.model', { child })}</p>

      <div className="rounded-xl border border-gray-100 bg-white px-3 py-3">
        <p className="text-sm font-semibold text-gray-800">{t('s5.teaser')}</p>
        <ul className="mt-1 list-disc list-inside text-sm text-gray-500">
          <li>{t('s5.teaserBullets.allowance')}</li>
          <li>{t('s5.teaserBullets.saving')}</li>
          <li>{t('s5.teaserBullets.rewards')}</li>
        </ul>
      </div>
    </div>
  );
}
