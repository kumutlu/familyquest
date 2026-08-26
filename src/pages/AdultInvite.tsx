import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { doc, setDoc } from 'firebase/firestore';
import { Button } from '../components/ui/Button';
import { GoogleButton } from '../components/ui/GoogleButton';
import { PublicAuthShell } from '../onboarding/components/PublicAuthShell';
import { signInWithGoogle } from '../lib/api';
import {
  acceptAdultInvitation,
  previewAdultInvitation,
  type AdultInvitationPreview,
} from '../lib/adultInvitationApi';
import {
  bindPendingInviteToUid,
  capturePendingInvite,
  clearPendingInvite,
  readPendingInvite,
  type PendingInviteClearReason,
} from '../auth/pendingInviteIntent';
import { useStore } from '../store/useStore';
import { db } from '../lib/firebase';

type Phase =
  | 'validating'
  | 'unauthenticated'
  | 'confirming'
  | 'accepting'
  | 'success'
  | 'terminal'
  | 'conflict';

type InviteFailureCode =
  | 'INVALID_INVITATION'
  | 'INVITATION_EXPIRED'
  | 'INVITATION_REVOKED'
  | 'INVITATION_ALREADY_USED'
  | 'FAMILY_UNAVAILABLE'
  | 'TOO_MANY_ATTEMPTS'
  | 'PROFILE_REQUIRED'
  | 'ALREADY_IN_ANOTHER_FAMILY'
  | 'INVITE_ACCOUNT_MISMATCH'
  | 'UNKNOWN';

type FailureTranslationKey =
  | 'adultInvite.errors.invalid'
  | 'adultInvite.errors.expired'
  | 'adultInvite.errors.revoked'
  | 'adultInvite.errors.used'
  | 'adultInvite.errors.familyUnavailable'
  | 'adultInvite.errors.rateLimited'
  | 'adultInvite.errors.profileRequired'
  | 'adultInvite.errors.otherFamily'
  | 'adultInvite.errors.accountMismatch'
  | 'adultInvite.errors.generic';

const CONFIRMED_TERMINAL_CODES = new Set<InviteFailureCode>([
  'INVALID_INVITATION',
  'INVITATION_EXPIRED',
  'INVITATION_REVOKED',
  'INVITATION_ALREADY_USED',
  'FAMILY_UNAVAILABLE',
]);

const ERROR_CODES: InviteFailureCode[] = [
  'INVITATION_ALREADY_USED',
  'ALREADY_IN_ANOTHER_FAMILY',
  'INVITATION_EXPIRED',
  'INVITATION_REVOKED',
  'FAMILY_UNAVAILABLE',
  'TOO_MANY_ATTEMPTS',
  'PROFILE_REQUIRED',
  'INVALID_INVITATION',
  'INVITE_ACCOUNT_MISMATCH',
];

function invitationFailureCode(error: unknown): InviteFailureCode {
  const candidate = error as { message?: unknown; details?: unknown } | null | undefined;
  const details = candidate?.details && typeof candidate.details === 'object'
    ? candidate.details as Record<string, unknown>
    : null;
  const safeSource = [candidate?.message, details?.reason, details?.code]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  return ERROR_CODES.find(code => safeSource.includes(code)) ?? 'UNKNOWN';
}

function terminalClearReason(code: InviteFailureCode): PendingInviteClearReason {
  if (code === 'INVITATION_EXPIRED') return 'expired';
  if (code === 'INVITATION_REVOKED') return 'revoked';
  if (code === 'INVITATION_ALREADY_USED') return 'used';
  return 'invalid';
}

function failureTranslationKey(code: InviteFailureCode): FailureTranslationKey {
  switch (code) {
    case 'INVALID_INVITATION': return 'adultInvite.errors.invalid';
    case 'INVITATION_EXPIRED': return 'adultInvite.errors.expired';
    case 'INVITATION_REVOKED': return 'adultInvite.errors.revoked';
    case 'INVITATION_ALREADY_USED': return 'adultInvite.errors.used';
    case 'FAMILY_UNAVAILABLE': return 'adultInvite.errors.familyUnavailable';
    case 'TOO_MANY_ATTEMPTS': return 'adultInvite.errors.rateLimited';
    case 'PROFILE_REQUIRED': return 'adultInvite.errors.profileRequired';
    case 'ALREADY_IN_ANOTHER_FAMILY': return 'adultInvite.errors.otherFamily';
    case 'INVITE_ACCOUNT_MISMATCH': return 'adultInvite.errors.accountMismatch';
    default: return 'adultInvite.errors.generic';
  }
}

/** Canonical public recipient journey for opaque adult invitation tokens. */
export function AdultInvite() {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('family');
  const authStatus = useStore(state => state.authStatus);
  const authUser = useStore(state => state.authUser);
  const currentUser = useStore(state => state.currentUser);
  const refreshCurrentUser = useStore(state => state.refreshCurrentUser);
  const requestId = useRef(crypto.randomUUID());

  const [phase, setPhase] = useState<Phase>('validating');
  const [preview, setPreview] = useState<AdultInvitationPreview | null>(null);
  const [failure, setFailure] = useState<InviteFailureCode | null>(null);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [googlePending, setGooglePending] = useState(false);
  const [successResult, setSuccessResult] = useState<'joined' | 'already_member' | null>(null);
  const [profileName, setProfileName] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPhase('validating');
    setPreview(null);
    setFailure(null);

    try {
      const pending = readPendingInvite();
      if (!pending || pending.token !== token) capturePendingInvite(token);
    } catch {
      setFailure('INVALID_INVITATION');
      setPhase('terminal');
      return () => { cancelled = true; };
    }

    previewAdultInvitation({ token })
      .then(result => {
        if (cancelled) return;
        setPreview(result);
      })
      .catch(error => {
        if (cancelled) return;
        setFailure(invitationFailureCode(error));
        setPhase('terminal');
      });

    return () => { cancelled = true; };
  }, [token, validationAttempt]);

  useEffect(() => {
    if (!preview) return;
    if (authStatus === 'unauthenticated') {
      setPhase('unauthenticated');
      return;
    }
    if (authStatus !== 'authenticated' || !authUser?.uid) {
      setPhase('validating');
      return;
    }

    try {
      bindPendingInviteToUid(authUser.uid);
    } catch (error) {
      setFailure(invitationFailureCode(error));
      setPhase('conflict');
      return;
    }

    setPhase(currentUser ? 'confirming' : 'validating');
  }, [authStatus, authUser?.uid, currentUser, preview]);

  const handleGoogle = useCallback(async () => {
    setGooglePending(true);
    setFailure(null);
    try {
      await signInWithGoogle();
    } catch {
      setFailure('UNKNOWN');
    } finally {
      setGooglePending(false);
    }
  }, []);

  const leave = useCallback((reason: PendingInviteClearReason = 'left') => {
    clearPendingInvite(reason);
    navigate('/', { replace: true });
  }, [navigate]);

  const handleAccept = useCallback(async () => {
    if (!authUser?.uid || !preview || !currentUser) return;
    setPhase('accepting');
    setFailure(null);
    try {
      // The server alone derives family and role from the invitation record.
      const result = await acceptAdultInvitation({
        token,
        clientReqId: requestId.current,
      });

      // Publish authoritative membership locally before entering AppLayout. This
      // prevents a successful recipient with a not-yet-updated listener snapshot
      // from being mistaken for a generic no-family onboarding user.
      await authUser.getIdToken(true);
      refreshCurrentUser(authUser.uid, { familyId: result.familyId, role: result.role });
      clearPendingInvite(result.result === 'already_member' ? 'already-member' : 'joined');
      setSuccessResult(result.result);
      setPhase('success');
      navigate(result.destination, { replace: true });
    } catch (error) {
      const code = invitationFailureCode(error);
      setFailure(code);
      if (code === 'ALREADY_IN_ANOTHER_FAMILY' || code === 'INVITE_ACCOUNT_MISMATCH') {
        setPhase('conflict');
      } else if (CONFIRMED_TERMINAL_CODES.has(code)) {
        setPhase('terminal');
      } else {
        setPhase('confirming');
      }
    }
  }, [authUser, currentUser, navigate, preview, refreshCurrentUser, token]);

  const handleCompleteProfile = useCallback(async () => {
    const displayName = profileName.trim();
    if (!authUser?.uid || !displayName) {
      setProfileSaveError(true);
      return;
    }

    setProfileSaving(true);
    setProfileSaveError(false);
    try {
      // This repair writes only the minimal identity field required by the
      // acceptance callable. Family and role remain exclusively server-owned.
      await setDoc(doc(db, 'users', authUser.uid), { displayName }, { merge: true });
      setFailure(null);
      await handleAccept();
    } catch {
      setProfileSaveError(true);
      setFailure('PROFILE_REQUIRED');
      setPhase('confirming');
    } finally {
      setProfileSaving(false);
    }
  }, [authUser?.uid, handleAccept, profileName]);

  const roleLabel = preview?.intendedRole === 'adult'
    ? t('adultInvite.roleAdult')
    : t('adultInvite.roleParent');
  const invitePath = `/invite/${encodeURIComponent(token)}`;
  const authNext = encodeURIComponent(invitePath);

  return (
    <PublicAuthShell
      visual={(
        <div aria-hidden="true" className="rounded-[2rem] border border-white/70 bg-white/70 p-8 shadow-lg dark:border-slate-700 dark:bg-slate-900/70">
          <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-indigo-100 text-4xl dark:bg-indigo-500/15">✦</div>
        </div>
      )}
      visualTitle={t('adultInvite.title')}
      visualCopy={preview ? preview.familyDisplayName : undefined}
    >
      <section className="rounded-[1.75rem] border border-white/80 bg-white/90 p-6 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/90 sm:p-8">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-slate-50">
          {t('adultInvite.title')}
        </h1>

        {phase === 'validating' && (
          <p role="status" aria-live="polite" className="mt-4 text-sm text-gray-600 dark:text-slate-300">
            {preview
              ? t('adultInvite.preparingAccount')
              : t('adultInvite.validating')}
          </p>
        )}

        {(phase === 'unauthenticated' || phase === 'confirming' || phase === 'accepting') && preview && (
          <>
            <p className="mt-5 rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-base font-semibold text-gray-800 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-slate-100">
              {phase === 'unauthenticated'
                ? t('adultInvite.invited', { family: preview.familyDisplayName })
                : t(
                    preview.intendedRole === 'adult'
                      ? 'adultInvite.confirmAdult'
                      : 'adultInvite.confirmParent',
                    { family: preview.familyDisplayName },
                  )}
            </p>
            <p className="mt-2 text-sm text-gray-600 dark:text-slate-300">
              {t('adultInvite.role', { role: roleLabel })}
            </p>
          </>
        )}

        {phase === 'unauthenticated' && preview && (
          <div className="mt-6 space-y-3">
            {failure && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {t(failureTranslationKey(failure))}
              </p>
            )}
            <GoogleButton onClick={handleGoogle} disabled={googlePending}>
              {googlePending
                ? t('adultInvite.authenticating')
                : t('adultInvite.continueGoogle')}
            </GoogleButton>
            <Link
              to={`/signup?next=${authNext}`}
              className="flex min-h-11 w-full items-center justify-center rounded-xl border-2 border-gray-200 px-4 text-sm font-semibold text-gray-700 hover:border-primary-500 hover:text-primary-600 dark:border-slate-700 dark:text-slate-200"
            >
              {t('adultInvite.continueEmail')}
            </Link>
            <Link
              to={`/login?next=${authNext}`}
              className="block text-center text-sm font-medium text-primary-600 hover:text-primary-500"
            >
              {t('adultInvite.signInEmail')}
            </Link>
            <Button fullWidth variant="ghost" onClick={() => leave('left')}>
              {t('adultInvite.leave')}
            </Button>
          </div>
        )}

        {(phase === 'confirming' || phase === 'accepting') && preview && (
          <div className="mt-6 space-y-3">
            {failure && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {t(failureTranslationKey(failure))}
              </p>
            )}
            {failure === 'PROFILE_REQUIRED' ? (
              <div className="space-y-3">
                <label htmlFor="adult-invite-display-name" className="block text-sm font-semibold text-gray-700 dark:text-slate-200">
                  {t('adultInvite.profileName')}
                </label>
                <input
                  id="adult-invite-display-name"
                  type="text"
                  autoComplete="name"
                  value={profileName}
                  onChange={event => setProfileName(event.target.value)}
                  className="block min-h-11 w-full rounded-xl border border-gray-300 bg-white px-4 py-2 text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                {profileSaveError && (
                  <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                    {t('adultInvite.errors.profileSave')}
                  </p>
                )}
                <Button fullWidth onClick={handleCompleteProfile} disabled={profileSaving}>
                  {profileSaving
                    ? t('adultInvite.profileSaving')
                    : t('adultInvite.profileSaveAndJoin')}
                </Button>
              </div>
            ) : (
              <Button fullWidth onClick={handleAccept} disabled={phase === 'accepting'}>
                {phase === 'accepting'
                  ? t('adultInvite.joining')
                  : t('adultInvite.join')}
              </Button>
            )}
            <Button fullWidth variant="ghost" onClick={() => leave('declined')} disabled={phase === 'accepting'}>
              {t('adultInvite.decline')}
            </Button>
          </div>
        )}

        {phase === 'success' && (
          <p role="status" aria-live="polite" className="mt-5 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
            {successResult === 'already_member'
              ? t('adultInvite.successAlreadyMember')
              : t('adultInvite.successJoined')}
          </p>
        )}

        {phase === 'terminal' && failure && (
          <div className="mt-5">
            <p role="alert" className="rounded-2xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
              {t(failureTranslationKey(failure))}
            </p>
            <div className="mt-5 space-y-3">
              {CONFIRMED_TERMINAL_CODES.has(failure) ? (
                <Button fullWidth onClick={() => leave(terminalClearReason(failure))}>
                  {t('adultInvite.leave')}
                </Button>
              ) : (
                <Button fullWidth onClick={() => setValidationAttempt(value => value + 1)}>
                  {t('adultInvite.retry')}
                </Button>
              )}
              <Button fullWidth variant="ghost" onClick={() => {
                clearPendingInvite('left');
                navigate('/join-family', { replace: true });
              }}>
                {t('adultInvite.manualJoin')}
              </Button>
            </div>
          </div>
        )}

        {phase === 'conflict' && failure && (
          <div className="mt-5">
            <p role="alert" className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
              {t(failureTranslationKey(failure))}
            </p>
            <Button
              className="mt-5"
              fullWidth
              variant="secondary"
              onClick={() => leave(failure === 'INVITE_ACCOUNT_MISMATCH' ? 'account-mismatch' : 'left')}
            >
              {t('adultInvite.leave')}
            </Button>
          </div>
        )}
      </section>
    </PublicAuthShell>
  );
}

export default AdultInvite;
