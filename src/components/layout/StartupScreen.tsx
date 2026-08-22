import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import type { StartupPhase } from './startupState';
import { reportStartupPhase, logStartupDiagnostic } from '../../startupDiagnostics';

/** Delay before the secondary reassurance line appears. */
export const STARTUP_REASSURANCE_DELAY_MS = 4000;

/**
 * Hard upper bound on a SINGLE startup phase (not on the whole startup).
 *
 * Firebase Auth, the profile listener and the family listeners can all stall
 * silently (offline device, blocked long-poll, permission-denied that never
 * surfaces), which previously left the app on a blank "Loading…" screen
 * forever. After this bound we show a recoverable *UI* state.
 *
 * The budget was raised from 15s to 20s because the family phase fans out to
 * ~20 parallel `getDocsFromServer` reads plus their listeners; on a slow but
 * perfectly healthy mobile connection that legitimately exceeded 15s and
 * produced the "Connection problem" false positive. The threshold change is a
 * secondary mitigation only — the primary fix is that reaching the bound is now
 * a *recoverable UI state* that clears itself the moment the phase resolves,
 * and that Retry genuinely restarts the bootstrap and its timers.
 */
export const STARTUP_TIMEOUT_MS = 20000;

export interface StartupScreenProps {
  phase: StartupPhase;
  /** Underlying bootstrap error message, if one was recorded. */
  error?: string | null;
  onRetry: () => void;
  /** Provided only when there is a session that can actually be ended. */
  onSignOut?: () => void;
  /**
   * Monotonic bootstrap attempt counter from the store. Changing it restarts
   * every startup timer even when the phase label itself is unchanged (e.g.
   * Retry pressed while still in the `family` phase).
   */
  attempt?: number;
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
export function StartupScreen({ phase, error, onRetry, onSignOut, attempt = 0 }: StartupScreenProps) {
  // `startup` is bundled synchronously (see src/i18n/config.ts) so the very
  // first paint is already localised in English and Turkish.
  const { t } = useTranslation('startup');
  const [showReassurance, setShowReassurance] = useState(false);
  // The timeout is recorded as the *attempt token it belongs to*, never as a
  // bare boolean. A stale token can therefore never leak into the next phase or
  // the next retry, not even for the single render before effects re-run.
  const [timedOutToken, setTimedOutToken] = useState<string | null>(null);

  const isLoadingPhase = phase === 'auth' || phase === 'profile' || phase === 'family';
  const token = `${phase}:${attempt}`;

  // Publish the current phase to the diagnostics module so the service-worker
  // controllerchange handler can tell whether a takeover happened mid-bootstrap.
  useEffect(() => {
    reportStartupPhase(phase);
  }, [phase]);

  useEffect(() => {
    setShowReassurance(false);
    if (!isLoadingPhase) return undefined;
    const handle = setTimeout(() => setShowReassurance(true), STARTUP_REASSURANCE_DELAY_MS);
    return () => clearTimeout(handle);
  }, [token, isLoadingPhase]);

  useEffect(() => {
    setTimedOutToken(null);
    if (!isLoadingPhase) return undefined;
    const handle = setTimeout(() => setTimedOutToken(token), STARTUP_TIMEOUT_MS);
    return () => clearTimeout(handle);
  }, [token, isLoadingPhase]);

  // A timeout is a per-phase, per-attempt UI recovery state. As soon as the
  // phase advances (late success, next phase, or a retry) the token no longer
  // matches and the loading screen returns automatically — no refresh needed.
  const failed = phase === 'error' || timedOutToken === token;
  const timedOut = timedOutToken === token;

  // A per-phase timeout (not a genuine bootstrap error) is classified with a
  // non-sensitive diagnostic so triage does not have to guess which gate
  // stalled. The user-facing copy stays generic and non-sensitive. This runs in
  // an effect (never during render) so it fires exactly once per timeout and
  // has no effect on the rendered output or on business behaviour.
  useEffect(() => {
    if (!timedOut) return;
    const code =
      phase === 'auth'
        ? 'AUTH_TIMEOUT'
        : phase === 'profile'
          ? 'PROFILE_LOAD_TIMEOUT'
          : 'FAMILY_LOAD_TIMEOUT';
    logStartupDiagnostic(code, { phase });
  }, [timedOut, phase]);

  if (phase === 'ready') return null;

  if (failed) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const errorKind = error?.startsWith('[Family]')
      ? 'family'
      : error?.startsWith('[FamilyVerificationDelayed]')
        ? 'family-delayed'
      : error?.startsWith('[Profile]') || error?.startsWith('[Auth')
        ? 'identity'
        : 'critical';
    const title = errorKind === 'family-delayed'
      ? t('familyDelayedTitle')
      : offline
      ? t('offlineTitle')
      : timedOut
        ? t('slowTitle')
        : t('criticalTitle');
    const body = errorKind === 'family-delayed'
      ? t('familyDelayedBody')
      : offline
      ? t('offlineBody')
      : timedOut
        ? t('timeoutBody')
        : errorKind === 'family'
          ? t('familyErrorBody')
          : errorKind === 'identity'
            ? t('identityErrorBody')
            : t('criticalErrorBody');
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div
          role="alert"
          className="bg-white p-6 rounded-2xl shadow-sm max-w-md w-full text-center border border-gray-100"
        >
          <div className="w-12 h-12 bg-danger-50 text-danger-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl font-bold" aria-hidden="true">!</span>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">{title}</h2>
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
