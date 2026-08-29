import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/Button';
import { GoogleButton } from '../components/ui/GoogleButton';
import { PublicAuthShell } from '../onboarding/components/PublicAuthShell';
import { signInWithGoogle } from '../lib/api';
import {
  acceptAdultInvitation,
  completeAdultInvitationProfile,
  previewAdultInvitation,
  type AdultInvitationPreview,
} from '../lib/adultInvitationApi';
import {
  bindPendingInviteToUid,
  capturePendingInvite,
  clearPendingInviteIfMatches,
  readPendingInvite,
  type PendingInviteClearReason,
} from '../auth/pendingInviteIntent';
import { useStore } from '../store/useStore';
import { mapAuthErrorKey, type AuthErrorKey } from '../auth/authErrorMessage';
import { recordInviteEvent } from '../auth/inviteAnalytics';

type InviteOperationScope = {
  generation: number;
  token: string;
  uid: string;
};

type ScopedRequestId = {
  key: string;
  value: string;
};

const previewRequests = new Map<string, Promise<AdultInvitationPreview>>();

function previewAdultInvitationOnce(token: string): Promise<AdultInvitationPreview> {
  const existing = previewRequests.get(token);
  if (existing) return existing;

  const request = previewAdultInvitation({ token });
  previewRequests.set(token, request);
  void request.then(
    () => {
      if (previewRequests.get(token) === request) previewRequests.delete(token);
    },
    () => {
      if (previewRequests.get(token) === request) previewRequests.delete(token);
    },
  );
  return request;
}

function scopedRequestId(
  reference: React.MutableRefObject<ScopedRequestId | null>,
  scope: InviteOperationScope,
): string {
  const key = `${scope.token}\u0000${scope.uid}`;
  if (reference.current?.key !== key) {
    reference.current = { key, value: crypto.randomUUID() };
  }
  return reference.current.value;
}

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
  const { t } = useTranslation(['family', 'auth']);
  const authStatus = useStore(state => state.authStatus);
  const authUser = useStore(state => state.authUser);
  const refreshCurrentUser = useStore(state => state.refreshCurrentUser);
  const lifecycleGeneration = useRef(0);
  const lifecycle = useRef({ generation: 0, token: '', uid: '', mounted: false });
  const acceptRequestId = useRef<ScopedRequestId | null>(null);
  const profileRequestId = useRef<ScopedRequestId | null>(null);

  const [phase, setPhase] = useState<Phase>('validating');
  const [preview, setPreview] = useState<AdultInvitationPreview | null>(null);
  const [failure, setFailure] = useState<InviteFailureCode | null>(null);
  const [authFailureKey, setAuthFailureKey] = useState<AuthErrorKey | null>(null);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [googlePending, setGooglePending] = useState(false);
  const [successResult, setSuccessResult] = useState<'joined' | 'already_member' | null>(null);
  const [profileName, setProfileName] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState(false);
  const [profileCompletionRequired, setProfileCompletionRequired] = useState(false);
  const authResumedRef = useRef<string | null>(null);

  useEffect(() => {
    const generation = ++lifecycleGeneration.current;
    lifecycle.current = {
      generation,
      token,
      uid: authUser?.uid ?? '',
      mounted: true,
    };
    acceptRequestId.current = null;
    profileRequestId.current = null;
    return () => {
      if (lifecycle.current.generation === generation) {
        lifecycle.current = {
          ...lifecycle.current,
          generation: ++lifecycleGeneration.current,
          mounted: false,
        };
      }
    };
  }, [authUser?.uid, token]);

  useEffect(() => {
    let cancelled = false;
    setPhase('validating');
    setPreview(null);
    setFailure(null);
    setAuthFailureKey(null);
    setProfileName('');
    setProfileSaving(false);
    setProfileSaveError(false);
    setProfileCompletionRequired(false);

    try {
      const pending = readPendingInvite();
      if (!pending || pending.token !== token) capturePendingInvite(token);
    } catch {
      setFailure('INVALID_INVITATION');
      setPhase('terminal');
      return () => { cancelled = true; };
    }

    previewAdultInvitationOnce(token)
      .then(result => {
        if (cancelled) return;
        setPreview(result);
      })
      .catch(error => {
        if (cancelled) return;
        const code = invitationFailureCode(error);
        const outcome = code === 'INVITATION_EXPIRED' ? 'expired'
          : code === 'INVITATION_REVOKED' ? 'revoked'
            : code === 'INVITATION_ALREADY_USED' ? 'already_used'
              : code === 'FAMILY_UNAVAILABLE' ? 'family_unavailable'
                : code === 'TOO_MANY_ATTEMPTS' ? 'rate_limited' : 'invalid_invitation';
        recordInviteEvent('invitation_preview_failed', { outcome, source: 'adult_invite' });
        if (code === 'INVITATION_EXPIRED') {
          recordInviteEvent('invitation_expired', { source: 'adult_invite' });
        }
        setFailure(code);
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
      recordInviteEvent('invitation_conflict', { outcome: 'conflict', source: 'adult_invite' });
      setFailure(invitationFailureCode(error));
      setPhase('conflict');
      return;
    }

    const authScope = `${token}:${authUser.uid}`;
    if (authResumedRef.current !== authScope) {
      authResumedRef.current = authScope;
      recordInviteEvent('invite_auth_resumed', {
        authProvider: 'unknown', role: preview.intendedRole, source: 'adult_invite',
      });
    }

    setPhase('confirming');
  }, [authStatus, authUser?.uid, preview]);

  const handleGoogle = useCallback(async () => {
    setGooglePending(true);
    setFailure(null);
    setAuthFailureKey(null);
    try {
      const authenticatedUser = await signInWithGoogle();
      if (authenticatedUser?.uid) bindPendingInviteToUid(authenticatedUser.uid);
    } catch (error) {
      const code = invitationFailureCode(error);
      if (code === 'INVITE_ACCOUNT_MISMATCH') {
        setFailure(code);
        setPhase('conflict');
      } else {
        setAuthFailureKey(mapAuthErrorKey(error, { pendingInvite: true }));
      }
    } finally {
      setGooglePending(false);
    }
  }, []);

  const leave = useCallback((reason: PendingInviteClearReason = 'left') => {
    clearPendingInviteIfMatches({ token }, reason);
    navigate('/', { replace: true });
  }, [navigate, token]);

  const captureOperationScope = useCallback((): InviteOperationScope | null => {
    const current = lifecycle.current;
    if (
      !current.mounted ||
      !authUser?.uid ||
      current.token !== token ||
      current.uid !== authUser.uid
    ) {
      return null;
    }
    return { generation: current.generation, token, uid: authUser.uid };
  }, [authUser?.uid, token]);

  const isOperationScopeCurrent = useCallback((scope: InviteOperationScope): boolean => {
    const current = lifecycle.current;
    return current.mounted &&
      current.generation === scope.generation &&
      current.token === scope.token &&
      current.uid === scope.uid;
  }, []);

  const applyFailure = useCallback((error: unknown, keepProfileForm: boolean) => {
    const code = invitationFailureCode(error);
    setFailure(code);
    if (code === 'ALREADY_IN_ANOTHER_FAMILY' || code === 'INVITE_ACCOUNT_MISMATCH') {
      recordInviteEvent('invitation_conflict', { outcome: 'conflict', source: 'adult_invite' });
      setProfileCompletionRequired(false);
      setPhase('conflict');
    } else if (CONFIRMED_TERMINAL_CODES.has(code)) {
      setProfileCompletionRequired(false);
      setPhase('terminal');
    } else {
      setProfileCompletionRequired(keepProfileForm || code === 'PROFILE_REQUIRED');
      setPhase('confirming');
    }
  }, []);

  const performAcceptance = useCallback(async (scope: InviteOperationScope) => {
    if (!preview || !authUser || !isOperationScopeCurrent(scope)) return;
    try {
      // The server alone derives family and role from the invitation record.
      const result = await acceptAdultInvitation({
        token: scope.token,
        clientReqId: scopedRequestId(acceptRequestId, scope),
      });
      if (!isOperationScopeCurrent(scope)) return;

      recordInviteEvent('invitation_accepted', {
        role: result.role === 'parent' || result.role === 'adult' ? result.role : undefined,
        outcome: 'success', source: 'adult_invite',
      });

      // Publish authoritative membership locally before entering AppLayout. This
      // prevents a successful recipient with a not-yet-updated listener snapshot
      // from being mistaken for a generic no-family onboarding user.
      await authUser.getIdToken(true);
      if (!isOperationScopeCurrent(scope)) return;
      refreshCurrentUser(scope.uid, { familyId: result.familyId, role: result.role });
      if (!isOperationScopeCurrent(scope)) return;
      clearPendingInviteIfMatches(
        { token: scope.token, authUid: scope.uid },
        result.result === 'already_member' ? 'already-member' : 'joined',
      );
      if (!isOperationScopeCurrent(scope)) return;
      setSuccessResult(result.result);
      setPhase('success');
      if (!isOperationScopeCurrent(scope)) return;
      navigate(result.destination, { replace: true });
    } catch (error) {
      if (!isOperationScopeCurrent(scope)) return;
      applyFailure(error, false);
    }
  }, [applyFailure, authUser, isOperationScopeCurrent, navigate, preview, refreshCurrentUser]);

  const handleAccept = useCallback(async () => {
    const scope = captureOperationScope();
    if (!scope || !preview) return;
    setPhase('accepting');
    setFailure(null);
    setProfileCompletionRequired(false);
    await performAcceptance(scope);
  }, [captureOperationScope, performAcceptance, preview]);

  const handleCompleteProfile = useCallback(async () => {
    const displayName = profileName.trim();
    const scope = captureOperationScope();
    if (!scope || !displayName) {
      setProfileSaveError(true);
      return;
    }

    setProfileSaving(true);
    setProfileSaveError(false);
    try {
      await completeAdultInvitationProfile({
        token: scope.token,
        displayName,
        clientReqId: scopedRequestId(profileRequestId, scope),
      });
      if (!isOperationScopeCurrent(scope)) return;
      setFailure(null);
      setProfileCompletionRequired(false);
      setPhase('accepting');
      if (!isOperationScopeCurrent(scope)) return;
      await performAcceptance(scope);
    } catch (error) {
      if (!isOperationScopeCurrent(scope)) return;
      setProfileSaveError(false);
      applyFailure(error, true);
    } finally {
      if (isOperationScopeCurrent(scope)) setProfileSaving(false);
    }
  }, [applyFailure, captureOperationScope, isOperationScopeCurrent, performAcceptance, profileName]);

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
            {(failure || authFailureKey) && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {authFailureKey ? t(authFailureKey) : t(failureTranslationKey(failure!))}
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
            {profileCompletionRequired ? (
              <div className="space-y-3">
                <label htmlFor="adult-invite-display-name" className="block text-sm font-semibold text-gray-700 dark:text-slate-200">
                  {t('adultInvite.profileName')}
                </label>
                <input
                  id="adult-invite-display-name"
                  type="text"
                  autoComplete="name"
                  maxLength={80}
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
                clearPendingInviteIfMatches({ token }, 'left');
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
