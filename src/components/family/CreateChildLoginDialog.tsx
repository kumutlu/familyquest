import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import {
  createChildLogin,
  mapChildLoginError,
  normalizeUsernamePreview,
  validateUsernameClient,
  validatePasswordClient,
  PASSWORD_MIN_LENGTH,
} from '../../lib/childLoginApi';

export interface CreateChildLoginMember {
  id: string;
  displayName: string;
}

interface CreateChildLoginDialogProps {
  /** The managed child to create a login for, or null when closed. */
  member: CreateChildLoginMember | null;
  onClose: () => void;
  /** Called after a successful creation with the (raw) username entered. */
  onSuccess: (username: string) => void;
}

const FORM_ID = 'create-child-login-form';

export function CreateChildLoginDialog({ member, onClose, onSuccess }: CreateChildLoginDialogProps) {
  const { t } = useTranslation(['family', 'common']);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [requireChange, setRequireChange] = useState(false);
  const [touched, setTouched] = useState({ username: false, password: false, confirm: false });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const usernameRef = useRef<HTMLInputElement>(null);
  // Guards against duplicate submissions (double-click / double Enter).
  const submittingRef = useRef(false);

  // Reset all transient state whenever the dialog is (re)opened for a member,
  // and immediately clear any password values so they are never retained.
  useEffect(() => {
    if (!member) return;
    setUsername('');
    setPassword('');
    setConfirm('');
    setRequireChange(false);
    setTouched({ username: false, password: false, confirm: false });
    setSubmitError(null);
    setSubmitting(false);
    submittingRef.current = false;
    // Move focus to the first field for keyboard users.
    const id = requestAnimationFrame(() => usernameRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [member]);

  const usernameError = validateUsernameClient(username);
  const passwordError = validatePasswordClient(password);
  const confirmError =
    confirm.length > 0 && confirm !== password ? 'Passwords do not match.' : null;

  const normalizedPreview = username.trim() ? normalizeUsernamePreview(username) : '';
  const showNormalizedPreview =
    normalizedPreview.length > 0 && normalizedPreview !== username.trim();

  const formValid =
    !usernameError && !passwordError && !confirmError && password.length > 0 && confirm.length > 0;

  const clearPasswords = () => {
    setPassword('');
    setConfirm('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ username: true, password: true, confirm: true });
    if (!formValid || !member || submitting || submittingRef.current) return;

    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createChildLogin({
        childId: member.id,
        username: username.trim(),
        password,
        requirePasswordChange: requireChange,
      });
      // Clear passwords immediately — never retain them.
      clearPasswords();
      onSuccess(username.trim());
    } catch (err) {
      // Allow a retry; do not keep the lock engaged on failure.
      submittingRef.current = false;
      setSubmitting(false);
      setSubmitError(mapChildLoginError(err));
    }
  };

  const handleCancel = () => {
    if (submitting) return;
    clearPasswords();
    onClose();
  };

  if (!member) return null;

  return (
    <Modal
      isOpen={Boolean(member)}
      onClose={handleCancel}
      title={t('family:createLogin.title', { name: member.displayName })}
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4" noValidate>
        <p className="rounded-xl bg-primary-50 p-3 text-sm text-primary-900">
          The child signs in with your family code, their family-scoped username, and their password.
        </p>
        {/* Username */}
        <div>
          <label htmlFor="cl-username" className="block text-sm font-medium text-gray-700">
            {t('family:createLogin.username')}
          </label>
          <input
            id="cl-username"
            ref={usernameRef}
            type="text"
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, username: true }))}
            aria-invalid={touched.username && Boolean(usernameError)}
            aria-describedby="cl-username-help cl-username-error"
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <p id="cl-username-help" className="text-xs text-gray-500 mt-1">
            {t('family:createLogin.usernameHelp')}
          </p>
          {showNormalizedPreview && (
            <p className="text-xs text-gray-500 mt-1">
              {t('family:createLogin.willBeSavedAs', { username: normalizedPreview })}
            </p>
          )}
          {touched.username && usernameError && (
            <p id="cl-username-error" className="text-xs text-danger-500 mt-1" role="alert">
              {usernameError}
            </p>
          )}
        </div>

        {/* Password */}
        <div>
          <label htmlFor="cl-password" className="block text-sm font-medium text-gray-700">
            {t('family:createLogin.password')}
          </label>
          <input
            id="cl-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, password: true }))}
            aria-invalid={touched.password && Boolean(passwordError)}
            aria-describedby="cl-password-help cl-password-error"
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <p id="cl-password-help" className="text-xs text-gray-500 mt-1">
            {t('family:createLogin.passwordHelp', { min: PASSWORD_MIN_LENGTH })}
          </p>
          {touched.password && passwordError && (
            <p id="cl-password-error" className="text-xs text-danger-500 mt-1" role="alert">
              {passwordError}
            </p>
          )}
        </div>

        {/* Confirm Password */}
        <div>
          <label htmlFor="cl-confirm" className="block text-sm font-medium text-gray-700">
            {t('family:createLogin.confirmPassword')}
          </label>
          <input
            id="cl-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, confirm: true }))}
            aria-invalid={touched.confirm && Boolean(confirmError)}
            aria-describedby="cl-confirm-error"
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          {touched.confirm && confirmError && (
            <p id="cl-confirm-error" className="text-xs text-danger-500 mt-1" role="alert">
              {t('family:createLogin.passwordsDoNotMatch')}
            </p>
          )}
        </div>

        {/* Require password change on first login */}
        <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            id="cl-require-change"
            type="checkbox"
            checked={requireChange}
            onChange={(e) => setRequireChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-500 focus:ring-primary-500"
          />
          <span>
            {t('family:createLogin.requireChange')}
          </span>
        </label>

        {/* Submission error */}
        {submitError && (
          <p className="text-sm text-danger-500 font-medium" role="alert">
            {submitError}
          </p>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={handleCancel}
            disabled={submitting}
            className="flex-1"
          >
            {t('common:cancel')}
          </Button>
          <Button
            type="submit"
            disabled={!formValid || submitting}
            className="flex-1"
          >
            {submitting ? t('common:creating') : t('family:createLogin.submit')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
