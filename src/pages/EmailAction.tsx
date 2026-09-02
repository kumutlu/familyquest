import { useEffect, useState } from 'react';
import { applyActionCode, checkActionCode, confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { PublicAuthShell } from '../onboarding/components/PublicAuthShell';
import { OnboardingVisual } from '../onboarding/components/OnboardingVisual';
import { FamilyHomeScene } from '../onboarding/visuals/OnboardingScenes';
import { auth } from '../lib/firebase';
import { EMAIL_ACTION_CONTINUE_PATH, parseEmailAction, type EmailActionKind } from '../auth/emailActionHandler';

type State = 'loading' | 'input' | 'success' | 'error';
const titleFor = (kind: EmailActionKind | 'invalid') => kind === 'verifyEmail' ? 'Verify your email' : kind === 'resetPassword' ? 'Reset your password' : 'Account security action';

export function EmailAction() {
  const location = useLocation();
  const navigate = useNavigate();
  const request = parseEmailAction(location.search);
  const [state, setState] = useState<State>(request.kind === 'invalid' ? 'error' : 'loading');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState(request.kind === 'invalid' ? 'This link is invalid or unsupported.' : 'Please wait while Queki processes this link.');

  useEffect(() => {
    if (request.kind === 'invalid') return;
    let cancelled = false;
    const run = async () => {
      try {
        if (request.kind === 'resetPassword') {
          await verifyPasswordResetCode(auth, request.oobCode);
          if (!cancelled) { setState('input'); setMessage('Choose a new password.'); }
        } else if (request.kind === 'revertSecondFactorAddition') {
          await checkActionCode(auth, request.oobCode);
          if (!cancelled) { setState('error'); setMessage('This security action must be completed from your account settings.'); }
        } else {
          const info = await checkActionCode(auth, request.oobCode);
          const expected = request.kind === 'verifyEmail' ? 'VERIFY_EMAIL' : request.kind === 'recoverEmail' ? 'RECOVER_EMAIL' : 'VERIFY_AND_CHANGE_EMAIL';
          if (info.operation !== expected) throw new Error('action-mismatch');
          await applyActionCode(auth, request.oobCode);
          if (!cancelled) { setState('success'); setMessage(request.kind === 'verifyEmail' ? 'Your email is verified.' : 'Your account email was updated.'); }
        }
      } catch { if (!cancelled) { setState('error'); setMessage('This link is invalid, expired, or has already been used.'); } }
    };
    void run();
    return () => { cancelled = true; };
  }, [location.search]);

  const submitReset = async () => {
    if (request.kind !== 'resetPassword' || password.length < 6) { setMessage('Choose a password with at least 6 characters.'); return; }
    const code = request.oobCode;
    try { await confirmPasswordReset(auth, code, password); setState('success'); setMessage('Your password has been reset.'); }
    catch { setState('error'); setMessage('We could not reset your password. Please request a new link.'); }
  };
  const destination = request.kind === 'verifyEmail' ? EMAIL_ACTION_CONTINUE_PATH : '/login';
  return <PublicAuthShell visual={<OnboardingVisual title={titleFor(request.kind)}><FamilyHomeScene label="Queki" /></OnboardingVisual>} visualTitle={titleFor(request.kind)}>
    <div className="mx-auto max-w-lg rounded-[1.75rem] bg-white p-8 text-center shadow-xl dark:bg-slate-900">
      <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-primary-600">Queki</p>
      <h1 className="mt-5 text-3xl font-extrabold text-gray-950 dark:text-white">{titleFor(request.kind)}</h1>
      <p role={state === 'error' ? 'alert' : 'status'} className="mt-3 text-gray-600 dark:text-slate-300">{message}</p>
      {state === 'input' && <div className="mt-6"><input aria-label="New password" type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full rounded-xl border p-3" /><Button fullWidth onClick={() => void submitReset()} className="mt-4">Save password</Button></div>}
      {state === 'success' && <Button fullWidth onClick={() => navigate(destination, { replace: true })} className="mt-6">Continue</Button>}
      {state === 'error' && <Button variant="secondary" fullWidth onClick={() => navigate('/login', { replace: true })} className="mt-6">Back to sign in</Button>}
    </div>
  </PublicAuthShell>;
}
