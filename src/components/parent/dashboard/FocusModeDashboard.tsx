import { useTranslation } from 'react-i18next';
import { useStore } from '../../../store/useStore';
import { NextActionCard } from '../../next-action/NextActionCard';
import { getFocusModeState } from '../../../lib/focusMode';
import { getGreeting } from './DashboardHeader';

/**
 * Focus Mode body for the Parent Dashboard.
 *
 * Visual hierarchy is intentionally limited to: welcome → next action →
 * progress. Every other dashboard widget is suppressed by the caller while
 * setup is incomplete.
 */
export function FocusModeDashboard({ onAddChild }: { onAddChild?: () => void }) {
  const { t } = useTranslation('dashboard');
  const { currentUser, familyMembers = [], rewards = [], tasks = [], joinRequests = [] } = useStore();
  const focus = getFocusModeState({ familyMembers, rewards, tasks, joinRequests, currentUser });

  if (!focus.isFocusMode) return null;

  const firstName = currentUser?.displayName?.split(' ')[0] || 'there';

  return (
    <div className="space-y-6 pb-8 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
      {/* Section 1 — Welcome */}
      <section className="rounded-2xl border border-gray-100 bg-white p-6">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
          {t(`header.${getGreeting()}`, { name: firstName })}
        </h1>
        <p className="mt-2 text-gray-500">{t('focus.welcomeSubtitle')}</p>
      </section>

      {/* Section 2 — Next action (exactly one primary CTA) */}
      <NextActionCard variant="focus" onAddChild={onAddChild} />

      {/* Section 3 — Human readable progress */}
      <p
        className="text-center text-sm font-medium text-gray-500"
        role="status"
        aria-label={t('focus.progressLabel')}
      >
        {t('focus.progress', { current: focus.stepNumber, total: focus.totalSteps })}
      </p>
    </div>
  );
}
