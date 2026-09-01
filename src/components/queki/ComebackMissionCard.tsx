import { useTranslation } from 'react-i18next';
import { RefreshCw, Sparkles } from 'lucide-react';
import { cn } from '../../lib/utils';
import { TactileCard } from './TactileCard';
import type { ComebackTier } from '../../domain/comeback/types';

/**
 * <ComebackMissionCard /> — read-only V1 presentation for a Comeback
 * Mission on the Child Home.
 *
 * Architectural rules
 * -------------------
 *  - Read-only. The card NEVER awards XP; it only signals opportunity.
 *    The authoritative XP award lives in the gamification processor,
 *    pinned by tests to the `COMEBACK_MISSION_XP_AWARDED` event type.
 *  - Tier is sourced from the resolver — never invented client-side.
 *  - The "completed" beat is rendered when the resolver reports
 *    `missionCompleted: true` so the child sees their achievement today
 *    without a second screen.
 *  - All copy comes from the i18n catalog (under `home.child.comeback.*`).
 *  - `return_1d` MUST NOT promise XP. Only `return_3d` (+25) and
 *    `return_7d` (+50) promise a return-XP bonus; the resolver is the
 *    sole authority on tier.
 *
 * Tone
 * ----
 *  - Returning users are WELCOMED, never punished.
 *  - Tone is playful and inviting — the mascot engine already enforces
 *    this on its own surfaces; this card follows the same law.
 */

export type ComebackMissionCardProps = {
  /** Resolved tier. The card hides itself when `tier === 'none'`. */
  readonly tier: ComebackTier;
  /** Family-local inactivity days (already capped to >= 0). */
  readonly inactivityDays: number;
  /** True when today's qualifying mission has already been completed. */
  readonly missionCompleted: boolean;
  /** Tap handler — typically navigates to the Quests board. */
  readonly onPress?: () => void;
  /** Optional layout class. */
  readonly className?: string;
};

const TIER_TONE: Record<Exclude<ComebackTier, 'none'>, {
  bg: string;
  fg: string;
  icon: string;
}> = {
  return_1d: {
    bg: 'bg-family-50',
    fg: 'text-family-700',
    icon: 'text-family-500',
  },
  return_3d: {
    bg: 'bg-xp-50',
    fg: 'text-xp-700',
    icon: 'text-xp-500',
  },
  return_7d: {
    bg: 'bg-streak-50',
    fg: 'text-streak-700',
    icon: 'text-streak-500',
  },
};

/**
 * Render the comeback card. Pure presentation. Hides itself when the
 * tier is `none` — the parent owns visibility, but we also guard here so
 * a stale render never shows a stale "Welcome back!" message.
 */
export function ComebackMissionCard({
  tier,
  inactivityDays,
  missionCompleted,
  onPress,
  className,
}: ComebackMissionCardProps) {
  const { t } = useTranslation('home');

  if (tier === 'none') return null;
  const tone = TIER_TONE[tier];

  const titleKey = missionCompleted
    ? `child.comeback.completed.${tier}.title`
    : `child.comeback.mission.${tier}.title`;
  const descKey = missionCompleted
    ? `child.comeback.completed.${tier}.description`
    : `child.comeback.mission.${tier}.description`;

  return (
    <TactileCard
      onClick={onPress}
      data-testid="comeback-mission-card"
      data-comeback-tier={tier}
      data-comeback-completed={missionCompleted ? '1' : '0'}
      className={cn('flex items-center gap-4 p-4', className)}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex h-11 w-11 items-center justify-center rounded-xl',
          tone.bg,
          tone.icon,
        )}
      >
        {missionCompleted ? <Sparkles size={22} /> : <RefreshCw size={22} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-card-title qk-text-primary">{t(titleKey, {
          days: inactivityDays,
        })}</p>
        <p className="mt-0.5 text-meta qk-text-secondary">
          {t(descKey, { days: inactivityDays })}
        </p>
      </div>
    </TactileCard>
  );
}

export default ComebackMissionCard;