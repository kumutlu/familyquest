import { useTranslation } from 'react-i18next';
import { useStore } from '../../../store/useStore';

export function getGreeting(date: Date = new Date()): 'morning' | 'afternoon' | 'evening' {
  const hour = date.getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

export function DashboardHeader() {
  const { t } = useTranslation('dashboard');
  const { currentUser, familyData } = useStore();

  const firstName = currentUser?.displayName?.split(' ')[0] || 'there';
  const familyName = familyData?.name;

  return (
    <header>
      <h1 className="text-2xl font-bold text-gray-900 tracking-tight sm:text-3xl">
        {t(`header.${getGreeting()}`, { name: firstName })}
      </h1>
      <p className="mt-1 text-gray-500">
        {t('header.subtitle')}
      </p>
      {familyName && (
        <span className="mt-3 inline-flex items-center rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700">
          {t('header.family', { name: familyName })}
        </span>
      )}
    </header>
  );
}
