import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import type { StartupPhase } from './startupState';

/** Delay before the secondary reassurance line appears. */
export const STARTUP_REASSURANCE_DELAY_MS = 4000;

/**
 * Hard upper bound on any single startup phase. Firebase Auth, the profile
 * listener and the family listeners can all stall silently (offline device,
 * blocked long-poll, permission-denied that never surfaces), which previously
 * left the app on a blank "Loading…" screen forever. After this bound we always
 * show a recoverable error.
 */
export const STARTUP_TIMEOUT_MS = 15000;

export interface StartupScreenProps {
  phase: StartupPhase;
  /** Underlying bootstrap error message, if one was recorded. */
  error?: string | null;
  onRetry: () => void;
  /** Provided only when there is a session that can actually be ended. */
  onSignOut?: () => void;
}

/** Honest, phase-specific step label shown under the primary message. */
const PHASE_STEP_KEY = {
  auth: 'stepAuth',
  profile: 'stepProfile',
  family: 'stepFamily',
} as const;

/**
 * Global startup experience: a deterministic, phase-aware loading screen with a
 * bounded timeout and recovery actions. It never renders a fabricated progress
 * percentage — only the phase it is genuinely waiting on.
 */
export function StartupScreen({ phase, error, onRetry, onSignOut }: StartupScreenProps) {
  // `startup` is bundled synchronously (see src/i18n/config.ts) so the very
  // first paint is already localised in English and Turkish.
  const { t } = useTranslation('startup');
  const [showReassurance, setShowReassurance] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  const isLoadingPhase = phase === 'auth' || phase === 'profile' || phase === 'family';

  useEffect(() => {
    setShowReassurance(false);
    if (!isLoadingPhase) return undefined;
    const handle = setTimeout(() => setShowReassurance(true), STARTUP_REASSURANCE_DELAY_MS);
    return () => clearTimeout(handle);
  }, [phase, isLoadingPhase]);

  useEffect(() => {
    setTimedOut(false);
    if (!isLoadingPhase) return undefined;
    const handle = setTimeout(() => setTimedOut(true), STARTUP_TIMEOUT_MS);
    return () => clearTimeout(handle);
  }, [phase, isLoadingPhase]);

  if (phase === 'ready') return null;

  const failed = phase === 'error' || timedOut;

  if (failed) {
    const body = phase === 'error' && error ? error : t('timeoutBody');
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div
          role="alert"
          className="bg-white p-6 rounded-2xl shadow-sm max-w-md w-full text-center border border-gray-100"
        >
          <div className="w-12 h-12 bg-danger-50 text-danger-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl font-bold" aria-hidden="true">!</span>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">{t('errorTitle')}</h2>
          <p className="text-gray-500 mb-6 text-sm">{body}</p>
          <div className="space-y-2">
            <Button onClick={onRetry} fullWidth>{t('retry')}</Button>
            {onSignOut ? (
              <Button variant="ghost" onClick={onSignOut} fullWidth>{t('signOut')}</Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const stepKey = PHASE_STEP_KEY[phase as 'auth' | 'profile' | 'family'];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center justify-center gap-3 text-center max-w-sm"
      >
        <Loader2 size={28} className="animate-spin text-primary-500" aria-hidden="true" />
        <p className="text-base font-semibold text-gray-700">{t('preparing')}</p>
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{t(stepKey)}</p>
        {showReassurance ? (
          <p data-testid="startup-reassurance" className="text-sm text-gray-500">
            {t('reassurance')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
