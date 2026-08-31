import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/Button';
import { PublicAuthShell } from '../onboarding/components/PublicAuthShell';
import { OnboardingVisual } from '../onboarding/components/OnboardingVisual';
import { FamilyHomeScene } from '../onboarding/visuals/OnboardingScenes';
import { refreshEmailVerification, resendVerificationEmail, signOut } from '../lib/api';
import { useStore } from '../store/useStore';
import { readPendingInvite } from '../auth/pendingInviteIntent';
import { readCreateFamilyIntent } from '../auth/createFamilyIntent';
import { readLegacyInviteCode } from '../lib/inviteLink';

const RESEND_COOLDOWN_MS = 60_000;

export function VerifyEmail() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const user = useStore(state => state.authUser);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [resendAvailableAt, setResendAvailableAt] = useState(0);

  useEffect(() => {
    if (!resendAvailableAt) return;
    const delay = Math.max(0, resendAvailableAt - Date.now());
    const timer = window.setTimeout(() => setResendAvailableAt(0), delay);
    return () => window.clearTimeout(timer);
  }, [resendAvailableAt]);

  const resumeDestination = () => {
    const pendingInvite = readPendingInvite();
    if (pendingInvite) return `/invite/${encodeURIComponent(pendingInvite.token)}`;
    const legacyCode = readLegacyInviteCode();
    if (legacyCode) return `/join?code=${encodeURIComponent(legacyCode)}`;
    if (user?.uid && readCreateFamilyIntent(user.uid)) return '/onboarding?mode=create';
    return '/';
  };

  const check = async () => {
    setBusy(true);
    setMessage('');
    try {
      if (await refreshEmailVerification()) navigate(resumeDestination(), { replace: true });
      else setMessage(t('verification.notVerified'));
    } catch {
      setMessage(t('verification.networkError'));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (Date.now() < resendAvailableAt) return;
    setBusy(true);
    setMessage('');
    try {
      await resendVerificationEmail();
      setResendAvailableAt(Date.now() + RESEND_COOLDOWN_MS);
      setMessage(t('verification.resent'));
    } catch (error: any) {
      setMessage(error?.code === 'auth/too-many-requests'
        ? t('errors.tooManyAttempts')
        : t('verification.networkError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PublicAuthShell
      visual={<OnboardingVisual title={t('verification.title')}><FamilyHomeScene label={t('verification.title')} /></OnboardingVisual>}
      visualTitle={t('verification.title')}
    >
      <div className="mx-auto max-w-lg rounded-[1.75rem] bg-white p-8 shadow-xl dark:bg-slate-900">
        <h1 className="text-3xl font-extrabold">{t('verification.title')}</h1>
        <p className="mt-3 text-gray-600 dark:text-slate-300">{t('verification.body', { email: user?.email ?? '' })}</p>
        {message && <p role="status" className="mt-4 text-sm">{message}</p>}
        <div className="mt-6 space-y-3">
          <Button fullWidth disabled={busy} onClick={check}>{busy ? t('verification.checking') : t('verification.verifiedAction')}</Button>
          <Button fullWidth variant="secondary" disabled={busy || Date.now() < resendAvailableAt} onClick={resend}>{t('verification.resend')}</Button>
          <button className="w-full text-sm text-primary-600" onClick={() => void signOut().then(() => navigate('/login', { replace: true }))}>{t('verification.differentEmail')}</button>
        </div>
      </div>
    </PublicAuthShell>
  );
}
