import { Check, ClipboardCheck, Gift, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface MiniJourneyProps { childName: string }

export function MiniJourney({ childName }: MiniJourneyProps) {
  const { t } = useTranslation('onboarding');
  const child = childName.trim() || 'your child';
  const stages = [
    { icon: ClipboardCheck, title: t('s5.step1', { child }), detail: t('s5.step1Card'), tone: 'bg-indigo-500', marker: 'task' },
    { icon: Check, title: t('s5.step2', { child }), detail: t('s5.step2Card'), tone: 'bg-emerald-500', marker: 'approval' },
    { icon: Star, title: t('s5.step3'), detail: '+20', tone: 'bg-amber-500', marker: 'points' },
    { icon: Gift, title: t('s5.step4'), detail: t('s5.step4Card'), tone: 'bg-rose-500', marker: 'reward' },
  ];

  return (
    <div>
      <div className="relative grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div aria-hidden="true" className="absolute left-[10%] right-[10%] top-6 hidden h-px bg-gradient-to-r from-indigo-200 via-amber-200 to-rose-200 sm:block dark:from-indigo-700 dark:via-amber-700/60 dark:to-rose-700" />
        {stages.map(({ icon: Icon, title, detail, tone, marker }) => (
          <div key={marker} data-testid={`mini-journey-${marker}`} className="relative rounded-2xl border border-gray-100 bg-gray-50/75 p-3 dark:border-slate-700 dark:bg-slate-800/65">
            <span aria-hidden="true" className={`relative flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-md ${tone}`}><Icon className="h-5 w-5" /></span>
            <p className="mt-2 text-xs font-bold leading-snug text-gray-800 dark:text-slate-100">{title}</p>
            <p className="mt-1 text-[11px] font-semibold leading-snug text-gray-500 dark:text-slate-400">{detail}</p>
            {marker === 'reward' ? <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-full bg-rose-100 dark:bg-slate-700"><div className="h-full w-1/5 rounded-full bg-rose-400" /></div> : null}
          </div>
        ))}
      </div>

      <p className="mt-3 rounded-xl bg-indigo-50/70 px-3 py-2 text-sm font-medium text-indigo-900 dark:bg-indigo-500/10 dark:text-white/90">{t('s5.model', { child })}</p>

      <div className="mt-3 rounded-2xl border border-gray-100 bg-white px-3 py-3 dark:border-slate-700 dark:bg-slate-900">
        <p className="text-sm font-semibold text-gray-800 dark:text-slate-100">{t('s5.teaser')}</p>
        <ul className="mt-2 flex flex-wrap gap-2 text-xs font-medium text-gray-500 dark:text-slate-400">
          <li className="rounded-full bg-gray-100 px-2.5 py-1 dark:bg-slate-800">{t('s5.teaserBullets.allowance')}</li>
          <li className="rounded-full bg-gray-100 px-2.5 py-1 dark:bg-slate-800">{t('s5.teaserBullets.saving')}</li>
          <li className="rounded-full bg-gray-100 px-2.5 py-1 dark:bg-slate-800">{t('s5.teaserBullets.rewards')}</li>
        </ul>
      </div>
    </div>
  );
}
