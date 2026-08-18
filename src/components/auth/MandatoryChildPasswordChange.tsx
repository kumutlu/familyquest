import { useState, type FormEvent } from 'react';
import { signOut } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { auth } from '../../lib/firebase';
import {
  completeChildPasswordChange,
  mapChildLoginError,
  validatePasswordClient,
} from '../../lib/childLoginApi';
import { Button } from '../ui/Button';

export function MandatoryChildPasswordChange() {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const validation = validatePasswordClient(password);
    if (validation) return setError(validation);
    if (password !== confirmation) return setError('Passwords do not match.');
    setBusy(true);
    setError('');
    try {
      await completeChildPasswordChange(password);
    } catch (cause) {
      console.error('[child-password-change] completion failed', cause);
      setError(mapChildLoginError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-dvh bg-gray-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Create your private password</h1>
          <p className="mt-2 text-sm text-gray-600">
            Your parent gave you a temporary password. Choose a new password only you know before continuing.
          </p>
        </div>
        <input
          type="password"
          value={password}
          onChange={event => setPassword(event.target.value)}
          aria-label="New private password"
          autoComplete="new-password"
          className="w-full rounded-xl border border-gray-200 px-4 py-3"
        />
        <input
          type="password"
          value={confirmation}
          onChange={event => setConfirmation(event.target.value)}
          aria-label="Confirm private password"
          autoComplete="new-password"
          className="w-full rounded-xl border border-gray-200 px-4 py-3"
        />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Saving…' : 'Save password and continue'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          disabled={busy}
          onClick={() => {
            void signOut(auth)
              .then(() => navigate('/login', { replace: true }))
              .catch(() => {});
          }}
        >
          Sign out
        </Button>
      </form>
    </main>
  );
}
