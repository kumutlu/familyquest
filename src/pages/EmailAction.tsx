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

const codeStatusMap = new Map<string, { state: State; message: string }>();

export function EmailAction() {
  const location = useLocation();
  const navigate = useNavigate();
  const request = parseEmailAction(location.search);
  const code = request.kind !== 'invalid' ? request.oobCode : '';
  const cached = code ? codeStatusMap.get(code) : undefined;

  const [state, setState] = useState<State>(
    request.kind === 'invalid' ? 'error' : (cached?.state ?? 'loading')
  );
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState(
    request.kind === 'invalid'
      ? 'This link is invalid or unsupported.'
      : (cached?.message ?? 'Please wait while Queki processes this link.')
  );

  useEffect(() => {
    if (request.kind === 'invalid' || !code) return;
    if (codeStatusMap.has(code)) {
      const result = codeStatusMap.get(code)!;
      setState(result.state);
      setMessage(result.message);
      return;
    }

    let active = true;
    const run = async () => {
      try {
        if (request.kind === 'resetPassword') {
          await verifyPasswordResetCode(auth, code);
          if (active) {
            setState('input');
            setMessage('Choose a new password.');
          }
        } else if (request.kind === 'revertSecondFactorAddition') {
          await checkActionCode(auth, code);
          if (active) {
            const res = { state: 'error' as State, message: 'This security action must be completed from your account settings.' };
            codeStatusMap.set(code, res);
            setState(res.state);
            setMessage(res.message);
          }
        } else {
          const info = await checkActionCode(auth, code);
          const expected = request.kind === 'verifyEmail' ? 'VERIFY_EMAIL' : request.kind === 'recoverEmail' ? 'RECOVER_EMAIL' : 'VERIFY_AND_CHANGE_EMAIL';
          if (info.operation !== expected) throw new Error('action-mismatch');
          await applyActionCode(auth, code);
          const successMsg = request.kind === 'verifyEmail' ? 'Your email is verified.' : 'Your account email was updated.';
          const res = { state: 'success' as State, message: successMsg };
          codeStatusMap.set(code, res);
          if (active) {
            setState(res.state);
            setMessage(res.message);
          }
        }
      } catch (err) {
        if (codeStatusMap.has(code)) {
          const res = codeStatusMap.get(code)!;
          if (active) {
            setState(res.state);
            setMessage(res.message);
          }
          return;
        }
        console.error('[EmailAction error]', err);
        const errRes = { state: 'error' as State, message: 'This link is invalid, expired, or has already been used.' };
        codeStatusMap.set(code, errRes);
        if (active) {
          setState(errRes.state);
          setMessage(errRes.message);
        }
      }
    };
    void run();
    return () => { active = false; };
  }, [location.search, request.kind, code]);

  const submitReset = async () => {
    if (request.kind !== 'resetPassword' || password.length < 6) {
      setMessage('Choose a password with at least 6 characters.');
      return;
    }
    try {
      await confirmPasswordReset(auth, code, password);
      const res = { state: 'success' as State, message: 'Your password has been reset.' };
      codeStatusMap.set(code, res);
      setState('success');
      setMessage(res.message);
    } catch {
      setState('error');
      setMessage('We could not reset your password. Please request a new link.');
    }
  };

  const destination = request.kind === 'verifyEmail' ? EMAIL_ACTION_CONTINUE_PATH : '/login';

  return (
    <PublicAuthShell visual={<OnboardingVisual title={titleFor(request.kind)}><FamilyHomeScene label="Queki" /></OnboardingVisual>} visualTitle={titleFor(request.kind)}>
      <div className="mx-auto max-w-lg rounded-[1.75rem] bg-white p-8 text-center shadow-xl dark:bg-slate-900">
        <p className="text-sm font-extrabold uppercase tracking-[0.2em] text-primary-600">Queki</p>
        <h1 className="mt-5 text-3xl font-extrabold text-gray-950 dark:text-white">{titleFor(request.kind)}</h1>
        <p role={state === 'error' ? 'alert' : 'status'} className="mt-3 text-gray-600 dark:text-slate-300">{message}</p>
        {state === 'input' && <div className="mt-6"><input aria-label="New password" type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full rounded-xl border p-3" /><Button fullWidth onClick={() => void submitReset()} className="mt-4">Save password</Button></div>}
        {state === 'success' && <Button fullWidth onClick={() => navigate(destination, { replace: true })} className="mt-6">Continue</Button>}
        {state === 'error' && <Button variant="secondary" fullWidth onClick={() => navigate('/login', { replace: true })} className="mt-6">Back to sign in</Button>}
      </div>
    </PublicAuthShell>
  );
}
