import { useTranslation } from 'react-i18next';
import { DAILY_CHECKIN_CATALOG, type DailyCheckinAnimal } from '../../lib/dailyCheckins';

export interface DailyCheckinBadgeProps {
  animal: DailyCheckinAnimal;
}

export function DailyCheckinBadge({ animal }: DailyCheckinBadgeProps) {
  const { t } = useTranslation('checkins');
  const option = DAILY_CHECKIN_CATALOG.find(item => item.id === animal);
  if (!option) return null;

  return (
    <div className="mb-4 inline-flex items-center gap-2 rounded-xl border border-primary-100 bg-primary-50 px-3 py-2 text-sm font-semibold text-primary-800">
      <span aria-hidden="true" className="text-lg leading-none">{option.emoji}</span>
      <span>{t('badge.today', { animal: t(option.nameKey) })}</span>
    </div>
  );
}
