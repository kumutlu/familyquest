import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/Button';
import {
  submitChildJoinRequest,
  getChildJoinRequestStatus,
  cancelChildJoinRequest,
  mapChildJoinErrorKey,
  storeJoinRequestHandle,
  readJoinRequestHandle,
  clearJoinRequestHandle,
  type ChildJoinRequestHandle,
  type ChildJoinRequestStatus,
} from '../lib/childJoinApi';
import { PublicAuthShell } from '../onboarding/components/PublicAuthShell';
import { OnboardingVisual } from '../onboarding/components/OnboardingVisual';
import { ManualJoinScene } from '../onboarding/visuals/OnboardingScenes';

/**
 * Child join entry flow.
 *
 * SECURITY BOUNDARY: submitting this form creates a PENDING join request only.
 * It grants no family membership, no child role and no family data access until
 * a parent of the target family approves it server-side. The password is passed
 * straight to the trusted callable and is never stored anywhere on the client
 * beyond the lifetime of this form.
 */
export function JoinFamily() {
  const { t } = useTranslation(['auth', 'common']);
  const navigate = useNavigate();

  const [familyCode, setFamilyCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [handle, setHandle] = useState<ChildJoinRequestHandle | null>(null);
  const [status, setStatus] = useState<ChildJoinRequestStatus | null>(null);

  // Restore an in-flight request (survives a reload while the child waits).
  useEffect(() => {
    const stored = readJoinRequestHandle();
    if (!stored) return;
    setHandle(stored);
    setStatus('pending');
    void getChildJoinRequestStatus(stored)
      .then(result => setStatus(result.status))
      .catch(() => {
        /* keep showing pending; Refresh status can retry */
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!familyCode.trim() || !username.trim() || !password || !confirmPassword) {
      setError(t('auth:joinFieldsRequired'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('auth:passwordsDoNotMatch'));
      return;
    }

    setSubmitting(true);
    try {
      const result = await submitChildJoinRequest({
        familyCode: familyCode.trim(),
        username: username.trim(),
        password,
      });
      const nextHandle: ChildJoinRequestHandle = {
        requestId: result.requestId,
        requestSecret: result.requestSecret,
        username: result.username,
      };
      storeJoinRequestHandle(nextHandle);
      // Drop every credential from component state immediately.
      setPassword('');
      setConfirmPassword('');
      setFamilyCode('');
      setHandle(nextHandle);
      setStatus('pending');
    } catch (err: unknown) {
      setError(t(mapChildJoinErrorKey(err)));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefresh = useCallback(async () => {
    if (!handle) return;
    setError('');
    setRefreshing(true);
    try {
      const result = await getChildJoinRequestStatus({
        requestId: handle.requestId,
        requestSecret: handle.requestSecret,
      });
      setStatus(result.status);
      if (result.status !== 'pending') clearJoinRequestHandle();
    } catch (err: unknown) {
      setError(t(mapChildJoinErrorKey(err)));
    } finally {
      setRefreshing(false);
    }
  }, [handle, t]);

  const handleCancel = useCallback(async () => {
    if (!handle) return;
    setError('');
    setRefreshing(true);
    try {
      await cancelChildJoinRequest({
        requestId: handle.requestId,
        requestSecret: handle.requestSecret,
      });
      setStatus('cancelled');
      clearJoinRequestHandle();
    } catch (err: unknown) {
      setError(t(mapChildJoinErrorKey(err)));
    } finally {
      setRefreshing(false);
    }
  }, [handle, t]);

  const startOver = () => {
    clearJoinRequestHandle();
    setHandle(null);
    setStatus(null);
    setUsername('');
    setError('');
  };

  const statusBody: Record<ChildJoinRequestStatus, string> = {
    pending: t('auth:childJoin.requestSentBody'),
    approved: t('auth:childJoin.approvedBody'),
    rejected: t('auth:childJoin.rejectedBody'),
    expired: t('auth:childJoin.expiredBody'),
    cancelled: t('auth:childJoin.cancelledBody'),
  };

  const inputClass =
    'appearance-none block min-h-12 w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-gray-900 shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-100 dark:placeholder-slate-500 sm:text-sm';

  return (
    <PublicAuthShell
      visual={<OnboardingVisual title={t('auth:joinYourFamily')}><ManualJoinScene label={t('auth:joinYourFamily')} /></OnboardingVisual>}
      mobileVisual={<OnboardingVisual title={t('auth:joinYourFamily')} className="max-h-44"><ManualJoinScene label={t('auth:joinYourFamily')} /></OnboardingVisual>}
      visualTitle={t('auth:joinYourFamily')}
    >
        <div className="rounded-[1.75rem] border border-white/80 bg-white/90 px-5 py-7 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/90 sm:px-8">
          {handle && status ? (
            <div>
              <h1 className="text-2xl font-extrabold text-gray-900 dark:text-slate-50">
                {t('auth:childJoin.requestSent')}
              </h1>
              <p className="mt-3 text-sm text-gray-600 dark:text-slate-300">{statusBody[status]}</p>

              {error && (
                <div role="alert" className="mt-4 text-red-500 text-sm">
                  {error}
                </div>
              )}

              <dl className="mt-6 space-y-3 rounded-2xl bg-gray-50 p-4 text-sm dark:bg-slate-800/70">
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500 dark:text-slate-400">{t('auth:childJoin.yourUsername')}</dt>
                  <dd className="font-medium text-gray-900 dark:text-slate-100">{handle.username}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500 dark:text-slate-400">{t('auth:childJoin.statusLabel')}</dt>
                  <dd className="rounded-full bg-white px-2 py-1 font-medium text-gray-900 dark:bg-slate-900 dark:text-slate-100">
                    {t(`auth:childJoin.status.${status}`)}
                  </dd>
                </div>
              </dl>

              <div className="mt-6 space-y-3">
                {status === 'pending' && (
                  <>
                    <Button type="button" fullWidth onClick={handleRefresh} disabled={refreshing}>
                      {refreshing
                        ? t('auth:childJoin.refreshing')
                        : t('auth:childJoin.refreshStatus')}
                    </Button>
                    <Button
                      type="button"
                      fullWidth
                      variant="secondary"
                      onClick={handleCancel}
                      disabled={refreshing}
                    >
                      {t('auth:childJoin.cancelRequest')}
                    </Button>
                  </>
                )}
                {(status === 'rejected' || status === 'expired' || status === 'cancelled') && (
                  <Button type="button" fullWidth variant="secondary" onClick={startOver}>
                    {t('auth:childJoin.startOver')}
                  </Button>
                )}
                <Button
                  type="button"
                  fullWidth
                  variant={status === 'pending' ? 'ghost' : 'primary'}
                  onClick={() => navigate('/login')}
                >
                  {t('auth:backToSignIn')}
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <h1 className="text-2xl font-extrabold text-gray-900 dark:text-slate-50 sm:text-3xl">{t('auth:joinYourFamily')}</h1>
              <p className="mt-2 text-sm text-gray-600 dark:text-slate-300">{t('auth:joinFamilyDescription')}</p>

              {error && (
                <div role="alert" className="mt-4 text-red-500 text-sm">
                  {error}
                </div>
              )}

              <form className="mt-6 space-y-5" onSubmit={handleSubmit} noValidate>
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-3 dark:border-indigo-500/20 dark:bg-indigo-500/10">
                  <label htmlFor="join-family-code" className="block text-sm font-bold text-primary-700 dark:text-indigo-300">{t('auth:familyCode')}</label>
                  <div className="mt-1">
                    <input
                      id="join-family-code"
                      type="text"
                      autoComplete="off"
                      value={familyCode}
                      onChange={e => setFamilyCode(e.target.value)}
                      className={`${inputClass} text-center text-lg font-black uppercase tracking-[0.2em]`}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="join-username" className="block text-sm font-medium text-gray-700 dark:text-slate-300">{t('auth:username')}</label>
                  <div className="mt-1">
                    <input
                      id="join-username"
                      type="text"
                      autoComplete="username"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="join-password" className="block text-sm font-medium text-gray-700 dark:text-slate-300">{t('auth:createPassword')}</label>
                  <div className="mt-1">
                    <input
                      id="join-password"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="join-confirm-password" className="block text-sm font-medium text-gray-700 dark:text-slate-300">{t('auth:confirmPassword')}</label>
                  <div className="mt-1">
                    <input
                      id="join-confirm-password"
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>

                <Button type="submit" fullWidth disabled={submitting}>
                  {submitting ? t('auth:childJoin.sending') : t('auth:childJoin.sendRequest')}
                </Button>
              </form>

              <div className="mt-6 text-center">
                <Link to="/login" className="text-sm font-medium text-primary-600 hover:text-primary-500">
                  {t('auth:backToSignIn')}
                </Link>
              </div>
            </div>
          )}
        </div>
    </PublicAuthShell>
  );
}
