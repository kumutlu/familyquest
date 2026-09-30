import { useCallback, useEffect, useRef, useState } from 'react';
import { applyActionCode } from 'firebase/auth';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/Button';
import { PublicAuthShell } from '../onboarding/components/PublicAuthShell';
import { OnboardingVisual } from '../onboarding/components/OnboardingVisual';
import { FamilyHomeScene } from '../onboarding/visuals/OnboardingScenes';
import { auth } from '../lib/firebase';
import {
  EMAIL_ACTION_CONTINUE_PATH,
  parseVerificationAction,
} from '../auth/emailActionHandler';

type PageState = 'working' | 'success' | 'expired' | 'alreadyVerified' | 'invalid' | 'network';

const errorCode = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';

export function EmailActionVerify() {
  const { t, i18n } = useTranslation('auth');
  const location = useLocation();
  const navigate = useNavigate();
  const request = parseVerificationAction(location.search);
  const oobCode = request.kind === 'verifyEmail' ? request.oobCode : null;
  const locale = request.kind === 'verifyEmail' ? request.locale : 'en';
  const [state, setState] = useState<PageState>('working');
  const startedRef = useRef(false);

  const redeem = useCallback(async () => {
    if (!oobCode) {
      setState('invalid');
      return;
    }

    setState('working');
    try {
      await applyActionCode(auth, oobCode);
      setState('success');
    } catch (error: unknown) {
      const code = errorCode(error);
      if (code === 'auth/expired-action-code') {
        setState('expired');
        return;
      }
      if (code === 'auth/invalid-action-code') {
        const currentUser = auth.currentUser;
        if (currentUser) {
          try {
            await currentUser.reload();
            if (currentUser.emailVerified) {
              setState('alreadyVerified');
              return;
            }
          } catch {
            // The action-code error remains authoritative if reload is unavailable.
          }
        }
        setState('invalid');
        return;
      }
      setState('network');
    }
  }, [oobCode]);

  useEffect(() => {
    if (i18n.language !== locale) {
      void i18n.changeLanguage(locale);
    }
  }, [i18n, locale]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void redeem();
  }, [redeem]);

  const successful = state === 'success' || state === 'alreadyVerified';
  const title = successful
    ? t('actionVerification.successTitle')
    : state === 'working'
      ? t('actionVerification.workingTitle')
      : t('actionVerification.errorTitle');

  const message = state === 'success'
    ? t('actionVerification.successBody')
    : state === 'alreadyVerified'
      ? t('actionVerification.alreadyVerified')
      : state === 'expired'
        ? t('actionVerification.expired')
        : state === 'network'
          ? t('actionVerification.network')
          : state === 'invalid'
            ? t('actionVerification.invalid')
            : t('actionVerification.workingBody');

  return (
    <PublicAuthShell
      visual={<OnboardingVisual title={title}><FamilyHomeScene label={title} /></OnboardingVisual>}
      visualTitle={title}
    >
      <div className="mx-auto max-w-lg rounded-[1.75rem] bg-white p-8 text-center shadow-xl dark:bg-slate-900">
        <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-primary-600">Queki</p>
        <div className="mx-auto mt-5 flex h-16 w-16 items-center justify-center rounded-full bg-primary-50 text-3xl dark:bg-indigo-500/15" aria-hidden="true">
          {successful ? '✓' : state === 'working' ? '…' : '!'}
        </div>
        <h1 className="mt-5 text-3xl font-extrabold text-gray-950 dark:text-white">{title}</h1>
        <p role={state === 'working' || successful ? 'status' : 'alert'} className="mt-3 text-gray-600 dark:text-slate-300">
          {message}
        </p>
        <div className="mt-7">
          {successful && (
            <Button fullWidth onClick={() => navigate(EMAIL_ACTION_CONTINUE_PATH, { replace: true })}>
              {t('actionVerification.continue')}
            </Button>
          )}
          {state === 'network' && (
            <Button fullWidth onClick={() => void redeem()}>{t('actionVerification.retry')}</Button>
          )}
          {(state === 'expired' || state === 'invalid') && (
            <Button fullWidth variant="secondary" onClick={() => navigate(EMAIL_ACTION_CONTINUE_PATH, { replace: true })}>
              {t('actionVerification.resendPath')}
            </Button>
          )}
        </div>
      </div>
    </PublicAuthShell>
  );
}
