import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getAvatarById } from '../../config/avatarCatalog';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';

interface AvatarUnlockSheetProps {
  avatarId: string;
  pointsBalance: number;
  onCancel: () => void;
  onConfirm: () => void;
  processing?: boolean;
  error?: string | null;
}

/**
 * Bottom-sheet confirmation for unlocking a premium avatar. Clearly explains the
 * one-time point cost and the balance after unlock. Never combines the unlock
 * charge into the profile "Submit for approval" action.
 */
export function AvatarUnlockSheet({
  avatarId,
  pointsBalance,
  onCancel,
  onConfirm,
  processing,
  error,
}: AvatarUnlockSheetProps) {
  const { t } = useTranslation('profile');
  const avatar = getAvatarById(avatarId);
  if (!avatar) return null;

  const cost = avatar.costPoints;
  const after = pointsBalance - cost;
  const insufficient = after < 0;
  const needed = -after;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('avatar.unlockAria', { name: avatar.name })}
      className="fixed inset-0 z-50 flex items-end justify-center bg-gray-900/40 backdrop-blur-sm p-0 sm:items-center sm:p-4"
    >
      <div className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl shadow-xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="px-6 pt-5 pb-4 border-b border-gray-100 flex flex-col items-center text-center gap-2">
          <Avatar src={avatar.imageUrl} fallback={avatar.name[0]} size="xl" />
          <h3 className="text-lg font-bold text-gray-900">{t('avatar.unlockTitle', { name: avatar.name })}</h3>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
            {t(`avatar.tier.${avatar.tier}`)}
          </span>
        </div>

        <div className="px-6 py-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">{t('avatar.cost')}</span>
            <span className="font-semibold text-gray-900">{t('avatar.points', { count: cost })}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">{t('avatar.yourBalance')}</span>
            <span className="font-semibold text-gray-900">{t('avatar.points', { count: pointsBalance })}</span>
          </div>
          <div className="flex justify-between border-t border-gray-100 pt-2">
            <span className="text-gray-500">{t('avatar.balanceAfter')}</span>
            <span className={insufficient ? 'font-semibold text-red-600' : 'font-semibold text-green-700'}>
              {t('avatar.points', { count: after })}
            </span>
          </div>

          {insufficient && (
            <div role="alert" className="flex items-start gap-2 p-3 bg-red-50 text-red-600 rounded-xl mt-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{t('avatar.needMorePoints', { count: needed })}</span>
            </div>
          )}

          {error && (
            <div role="alert" className="p-3 bg-red-50 text-red-600 rounded-xl mt-2">
              {error}
            </div>
          )}

          <p className="text-xs text-gray-500 pt-1">
            {t('avatar.staysInCollection')}
          </p>
        </div>

        <div className="px-6 pb-2 flex gap-3">
          <Button type="button" variant="outline" fullWidth onClick={onCancel} disabled={processing}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            fullWidth
            disabled={processing || insufficient}
            onClick={onConfirm}
          >
            {processing ? t('avatar.unlocking') : t('avatar.unlockFor', { cost })}
          </Button>
        </div>
      </div>
    </div>
  );
}
