import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { Button } from '../ui/Button';
import { RequestStatusBadge } from './RequestStatusBadge';
import { RequestDetailContent } from './RequestDetailContent';
import { normalizeRequest, type RequestContext, type NormalizedRequest } from '../../lib/requestModel';
import { currencySymbolFromCode, resolveFamilyCurrencyCode } from '../../i18n/format';

interface RequestDetailSheetProps {
  /** Raw request document carrying a `category` field, or null when closed. */
  request: any | null;
  onClose: () => void;
  onResolved?: () => void;
}

/**
 * Universal request detail surface.
 * - Mobile: a bottom sheet (anchored to the bottom, rounded top).
 * - Desktop: a centered modal.
 * Both behaviours are achieved with a single responsive container so there is
 * no duplicated markup across breakpoints.
 */
export function RequestDetailSheet({ request, onClose, onResolved }: RequestDetailSheetProps) {
  const currentUser = useStore(state => state.currentUser);
  const familyMembers = useStore(state => state.familyMembers);
  const familyData = useStore(state => state.familyData);
  const tasks = useStore(state => state.tasks);
  const rewards = useStore(state => state.rewards);

  const [retry, setRetry] = useState(0);
  const { t } = useTranslation(['requests', 'common']);

  const { normalized, failed } = useMemo<{ normalized: NormalizedRequest | null; failed: boolean }>(() => {
    if (!request) return { normalized: null, failed: false };
    const ctx: RequestContext = {
      currency: currencySymbolFromCode(resolveFamilyCurrencyCode(familyData)),
      resolveMember: id => {
        const member = familyMembers.find(m => m.id === id);
        return member
          ? { id: member.id, name: member.displayName, avatarUrl: member.avatarUrl, role: member.role }
          : undefined;
      },
      resolveTask: id => {
        const task = tasks.find(t => t.id === id);
        return task ? { title: task.title, pointsReward: task.pointsReward } : undefined;
      },
      rewards: rewards.reduce<Record<string, { title: string }>>((acc, reward) => {
        acc[reward.id] = { title: reward.title };
        return acc;
      }, {}),
    };
    try {
      return { normalized: normalizeRequest(request, ctx), failed: false };
    } catch {
      return { normalized: null, failed: true };
    }
  }, [request, familyMembers, familyData, tasks, rewards, retry]);

  useEffect(() => {
    setRetry(0);
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, onClose]);

  if (!request) return null;

  // Friendly, non-crashing fallback for data that cannot be loaded/normalised.
  if (failed || !normalized) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-end md:items-center md:justify-center p-0 md:p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="request-detail-error-title"
      >
        <div
          className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />
        <div className="request-detail-panel relative w-full md:max-w-md bg-white md:rounded-3xl rounded-t-3xl max-h-[90dvh] md:max-h-[85dvh] overflow-y-auto shadow-xl p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          <div className="flex items-start justify-between gap-3 mb-4">
            <h3 id="request-detail-error-title" className="text-lg font-bold text-gray-900">
              {t('requests:error.title')}
            </h3>
            <button
              onClick={onClose}
              aria-label={t('common:closeDialog')}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors ml-auto shrink-0"
            >
              <X size={20} />
            </button>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            {t('requests:error.body')}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" fullWidth onClick={onClose}>
              {t('requests:error.close')}
            </Button>
            <Button
              className="bg-primary-500 hover:bg-primary-600 text-white"
              fullWidth
              onClick={() => setRetry(r => r + 1)}
            >
              {t('common:tryAgain')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center md:justify-center p-0 md:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="request-detail-title"
    >
      <div
        className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="request-detail-panel relative w-full md:max-w-md bg-white md:rounded-3xl rounded-t-3xl max-h-[90dvh] md:max-h-[85dvh] overflow-y-auto shadow-xl animate-in fade-in slide-in-from-bottom md:slide-in-from-bottom-0 zoom-in-95 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
        <header className="sticky top-0 z-10 bg-white px-6 py-4 border-b border-gray-50 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="request-detail-title" className="text-lg font-bold text-gray-900 truncate">
              {normalized.typeLabel}
            </h3>
            <div className="mt-1">
              <RequestStatusBadge statusKind={normalized.statusKind} statusLabel={normalized.statusLabel} />
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t('common:closeDialog')}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors ml-auto shrink-0"
          >
            <X size={20} />
          </button>
        </header>
        <div className="p-6">
          <RequestDetailContent
            request={normalized}
            currentUser={currentUser}
            familyId={currentUser?.familyId}
            onClose={onClose}
            onResolved={onResolved}
          />
        </div>
      </div>
    </div>
  );
}
