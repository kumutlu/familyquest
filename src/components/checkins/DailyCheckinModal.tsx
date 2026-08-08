import { useTranslation } from 'react-i18next';
import { DAILY_CHECKIN_CATALOG, type DailyCheckinAnimal } from '../../lib/dailyCheckins';
import { Modal } from '../ui/Modal';

export interface DailyCheckinModalProps {
  open: boolean;
  locked: boolean;
  error: string | null;
  onSelect: (animal: DailyCheckinAnimal) => void;
  onDismiss: () => void;
}

export function DailyCheckinModal({
  open,
  locked,
  error,
  onSelect,
  onDismiss,
}: DailyCheckinModalProps) {
  const { t } = useTranslation('checkins');

  return (
    <Modal
      isOpen={open}
      onClose={onDismiss}
      preventClose={locked}
      title={t('modal.title')}
    >
      <p className="mb-5 text-sm text-gray-600">{t('modal.supporting')}</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {DAILY_CHECKIN_CATALOG.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={locked}
            aria-label={t(option.ariaKey)}
            onClick={() => onSelect(option.id)}
            className="flex min-h-28 flex-col items-center justify-center rounded-2xl border border-gray-200 bg-white p-3 text-center transition-colors hover:border-primary-300 hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
          >
            <span aria-hidden="true" className="text-4xl leading-none">{option.emoji}</span>
            <span className="mt-2 text-sm font-semibold text-gray-900">{t(option.nameKey)}</span>
            <span className="mt-0.5 text-xs text-gray-500">{t(option.feelingKey)}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        disabled={locked}
        onClick={onDismiss}
        className="mt-5 w-full rounded-xl px-4 py-3 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
      >
        {t('modal.skip')}
      </button>

      <div
        role={error ? 'alert' : 'status'}
        aria-live="polite"
        className="mt-3 min-h-5 text-center text-sm text-gray-600"
      >
        {error ?? (locked ? t('modal.saving') : '')}
      </div>
    </Modal>
  );
}
