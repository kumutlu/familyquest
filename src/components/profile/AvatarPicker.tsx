import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, Check } from 'lucide-react';
import { AVATAR_CATALOG, type AvatarTier } from '../../config/avatarCatalog';
import { Avatar } from '../ui/Avatar';
import { cn } from '../../lib/utils';

type Filter = 'all' | 'owned' | 'starter' | 'premium';

interface AvatarPickerProps {
  /** Currently selected catalog avatar id (or null for legacy). */
  selectedAvatarId: string | null;
  /** Set of avatar ids the current user owns (premium unlocks). */
  ownedAvatarIds: string[];
  /** Current reward points balance (for premium affordability display). */
  pointsBalance: number;
  /** Called when the user picks an avatar (owned or starter). */
  onSelect: (avatarId: string) => void;
  /** Called when the user taps a locked premium avatar to begin unlock. */
  onRequestUnlock: (avatarId: string) => void;
  /** Disable interaction (e.g. while a request is pending). */
  disabled?: boolean;
}

const TIER_ORDER: AvatarTier[] = ['starter', 'rare', 'epic', 'legendary'];

const TIER_BADGE: Record<AvatarTier, string> = {
  starter: 'bg-gray-100 text-gray-600',
  rare: 'bg-sky-100 text-sky-700',
  epic: 'bg-violet-100 text-violet-700',
  legendary: 'bg-amber-100 text-amber-700',
};

export function AvatarPicker({
  selectedAvatarId,
  ownedAvatarIds,
  pointsBalance,
  onSelect,
  onRequestUnlock,
  disabled,
}: AvatarPickerProps) {
  const { t } = useTranslation('profile');
  const [filter, setFilter] = useState<Filter>('all');

  const avatars = useMemo(() => {
    const sorted = [...AVATAR_CATALOG].sort((a, b) => a.sortOrder - b.sortOrder);
    switch (filter) {
      case 'owned':
        return sorted.filter(a => a.tier === 'starter' || ownedAvatarIds.includes(a.id));
      case 'starter':
        return sorted.filter(a => a.tier === 'starter');
      case 'premium':
        return sorted.filter(a => a.unlockType === 'points');
      default:
        return sorted;
    }
  }, [filter, ownedAvatarIds]);

  const tabs: { key: Filter; label: string }[] = [
    { key: 'all', label: t('avatar.tabs.all') },
    { key: 'owned', label: t('avatar.tabs.owned') },
    { key: 'starter', label: t('avatar.tabs.starter') },
    { key: 'premium', label: t('avatar.tabs.premium') },
  ];

  return (
    <div>
      {/* Filter tabs */}
      <div role="tablist" aria-label={t('avatar.filterLabel')} className="flex gap-2 mb-3 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={filter === tab.key}
            disabled={disabled}
            onClick={() => setFilter(tab.key)}
            className={cn(
              'px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors',
              filter === tab.key
                ? 'bg-primary-500 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
              disabled && 'opacity-50 cursor-not-allowed',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Avatar grid — 2 columns on narrow phones, 3-4 on larger; no fixed
          widths, no horizontal overflow, cards use min-w-0 so names wrap. */}
      <div
        role="grid"
        aria-label={t('avatar.chooseLabel')}
        className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-72 overflow-y-auto overscroll-contain pr-1"
      >
        {avatars.map(avatar => {
          const isOwned = avatar.tier === 'starter' || ownedAvatarIds.includes(avatar.id);
          const isLocked = !isOwned;
          const isSelected = selectedAvatarId === avatar.id;
          const affordable = pointsBalance >= avatar.costPoints;
          const tierLabel = t(`avatar.tier.${avatar.tier}`);

          return (
            <button
              key={avatar.id}
              role="gridcell"
              type="button"
              disabled={disabled}
              aria-pressed={isSelected}
              aria-label={`${avatar.name}, ${tierLabel}${isLocked ? t('avatar.lockedSuffix', { cost: avatar.costPoints }) : t('avatar.ownedSuffix')}${isSelected ? t('avatar.selectedSuffix') : ''}`}
              onClick={() => (isLocked ? onRequestUnlock(avatar.id) : onSelect(avatar.id))}
              className={cn(
                'relative flex flex-col items-center gap-1.5 rounded-2xl p-2 min-w-0 border-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                isSelected ? 'border-primary-500 bg-primary-50' : 'border-transparent bg-gray-50 hover:border-gray-200',
                disabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              <div className="relative">
                <Avatar src={avatar.imageUrl} fallback={avatar.name[0]} size="lg" />
                {isSelected && (
                  <span className="absolute -bottom-1 -right-1 bg-primary-500 text-white rounded-full p-0.5" aria-hidden="true">
                    <Check size={14} />
                  </span>
                )}
                {isLocked && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-full" aria-hidden="true">
                    <Lock size={18} className="text-white" />
                  </span>
                )}
              </div>
              <span className="w-full text-xs font-medium text-gray-800 text-center leading-tight break-words">
                {avatar.name}
              </span>
              <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full', TIER_BADGE[avatar.tier])}>
                {tierLabel}
              </span>
              <span className="text-[10px] text-gray-500">
                {isOwned ? t('avatar.free') : t('avatar.points', { count: avatar.costPoints })}
              </span>
              {isLocked && !affordable && (
                <span className="text-[10px] text-red-500 font-medium">{t('avatar.needMore', { count: avatar.costPoints - pointsBalance })}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { TIER_ORDER };
