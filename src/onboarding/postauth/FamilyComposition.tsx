import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { AdultInviteCard } from '../../components/family/AdultInviteCard';
import { OnboardingCard } from '../components/OnboardingCard';
import { OnboardingError } from '../components/OnboardingError';
import { useStore } from '../../store/useStore';
import { ensureFamily, type SetupDeps } from '../lib/onboardingSetup';
import {
  classifyOnboardingError,
  withBoundedTimeout,
  PROFILE_WAIT_MS,
  SETUP_WAIT_MS,
} from '../lib/onboardingErrors';
import { saveDraft, type OnboardingDraft } from '../lib/onboardingDraft';
import { recordE2ETimeline } from '../../lib/e2eDiagnostics';
import { readCreateFamilyIntent } from '../../auth/createFamilyIntent';

interface FamilyCompositionProps {
  draft: OnboardingDraft;
  patch: (partial: Partial<OnboardingDraft>) => void;
  goNext: () => void;
  deps: SetupDeps;
  onFinish?: () => void;
}

/**
 * P1 — Family composition. Runs the idempotent family + first-child creation
 * once the *authoritative* user document is confirmed available on the server
 * (see PRIORITY 0 race fix), then offers optional "Add another child" and
 * "Invite another parent".
 *
 * Lifecycle safety (PRIORITY 1 StrictMode fix): the setup effect is guarded by
 * `startedRef`/`completedRef` rather than a brittle one-shot `ranRef`. Under
 * React StrictMode the effect double-invokes (mount → cleanup → mount); the
 * first run is allowed to complete and persist the draft even though StrictMode
 * simulates an unmount, so setup is never left in a permanent disabled state and
 * is never executed twice.
 */
export function FamilyComposition({ draft, patch, goNext, deps, onFinish }: FamilyCompositionProps) {
  recordE2ETimeline('p1-render');
  const { t } = useTranslation('onboarding');
  const currentUser = useStore(state => state.currentUser);
  // Authoritative prerequisite: the user profile document is confirmed present
  // on the server. Setup must wait for this before calling createFamilyAndParent.
  const profileServerConfirmed = useStore(state => state.profileServerConfirmed);
  const profileLoading = useStore(state => state.profileLoading);

  const [phase, setPhase] = useState<'waiting' | 'ready' | 'error'>('waiting');
  const [error, setError] = useState<string | null>(null);
  const [errorTitle, setErrorTitle] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [extraChildren, setExtraChildren] = useState<string[]>([]);
  const [showAddChild, setShowAddChild] = useState(false);
  const [newChildName, setNewChildName] = useState('');
  const [showAdultInvite, setShowAdultInvite] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  // Lifecycle-safe idempotency refs (StrictMode-safe).
  const startedRef = useRef(false);
  const completedRef = useRef(false);
  // Capture the fresh authorization for this mount. Keeping the UID (rather
  // than a bare boolean) makes an in-place account switch fail closed, while
  // allowing the same async attempt to finish after successful creation clears
  // its persisted intent.
  const authorizedUidRef = useRef(
    deps.uid && readCreateFamilyIntent(deps.uid) ? deps.uid : null,
  );
  const creationAuthorized = authorizedUidRef.current === deps.uid;

  // Wait for the authoritative user document before running setup.
  useEffect(() => {
    if (phase === 'ready' || phase === 'error') return;
    if (profileServerConfirmed && currentUser) {
      setPhase('ready');
      return;
    }
    // Genuine persistent failure: profile never resolved (not-found / auth issue).
    if (!currentUser && !profileLoading) {
      setErrorTitle(t('p1.errorTitle'));
      setError(t('errors.profileUnavailable'));
      setPhase('error');
      return;
    }
    // Bounded recovery: if the authoritative profile does not arrive in time,
    // surface a human-readable, recoverable error (never an indefinite spinner).
    const timer = setTimeout(() => {
      if (!profileServerConfirmed) {
        setErrorTitle(t('p1.errorTitle'));
        setError(t('errors.profileUnavailable'));
        setPhase('error');
      }
    }, PROFILE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [phase, profileServerConfirmed, currentUser, profileLoading, retryNonce, t]);

  // Setup effect — runs only once the authoritative prerequisite is ready.
  useEffect(() => {
    if (!creationAuthorized) return;
    if (phase !== 'ready') return;
    if (completedRef.current) return;
    if (draft.familyId) {
      completedRef.current = true;
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;
    void (async () => {
      setCreating(true);
      setError(null);
      try {
        let next = draft;
        if (!next.familyId) {
          recordE2ETimeline('ensure-family-start');
          next = await withBoundedTimeout(ensureFamily(next, deps), SETUP_WAIT_MS, t('errors.offline'));
          recordE2ETimeline('ensure-family-end', { familyId: next.familyId });
          saveDraft(next);
        }
        completedRef.current = true;
        patch({ familyId: next.familyId });
      } catch (caught: unknown) {
        startedRef.current = false; // allow a retry to re-run setup
        if (!cancelled) {
          setErrorTitle(t('p1.errorTitle'));
          setError(classifyOnboardingError(caught, t, 'errors.familyFailed'));
          setPhase('error');
        }
      } finally {
        if (!cancelled) setCreating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [creationAuthorized, phase, draft, deps, patch, t, retryNonce]);

  const handleRetry = () => {
    startedRef.current = false;
    completedRef.current = false;
    setError(null);
    setErrorTitle(null);
    setCreating(false);
    setPhase('waiting');
    setRetryNonce(nonce => nonce + 1);
  };

  const parentName = currentUser?.displayName || draft.parentFirstName.trim() || '—';
  const firstChild = draft.childFirstName?.trim() || '';

  const members = [
    { id: 'parent', name: parentName, role: 'owner' as const },
    ...(firstChild ? [{ id: 'first-child', name: firstChild, role: 'child' as const }] : []),
    ...extraChildren.map((name, index) => ({ id: `extra-${index}`, name, role: 'child' as const })),
  ];

  const handleAddChild = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = newChildName.trim();
    if (!name || !draft.familyId) return;
    try {
      await deps.createManagedMember(draft.familyId, 'child', name);
      setExtraChildren(prev => [...prev, name]);
      setNewChildName('');
      setShowAddChild(false);
    } catch {
      setError(t('errors.childFailed'));
    }
  };

  const handleInvite = () => setShowAdultInvite(true);

  const showError = phase === 'error' && Boolean(error);
  const showLoading =
    phase === 'waiting' || (phase === 'ready' && (!draft.familyId || creating));

  if (showError) {
    return (
      <OnboardingCard>
        <OnboardingError
          title={errorTitle ?? t('p1.title')}
          message={error ?? t('errors.familyFailed')}
          onRetry={handleRetry}
          onBack={goNext}
        />
      </OnboardingCard>
    );
  }

  if (showLoading) {
    return (
      <OnboardingCard>
        <div className="py-8 text-center" role="status" aria-live="polite">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[1.5rem] bg-primary-50 dark:bg-indigo-500/15">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-200 border-t-primary-500 motion-reduce:animate-none" />
          </div>
          <p className="mt-4 text-sm font-semibold text-gray-500 dark:text-slate-400">{t('p1.settingUp')}</p>
        </div>
      </OnboardingCard>
    );
  }

  return (
    <OnboardingCard>
      <h1 className="text-2xl font-extrabold text-gray-900 dark:text-slate-50 sm:text-3xl">{t('p1.title')}</h1>

      <h2 className="mt-5 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">{t('p1.membersHeading')}</h2>
      <ul className="mt-2 space-y-2" aria-label={t('p1.membersHeading')}>
        {members.map(member => (
          <li
            key={member.id}
            className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-gray-50/80 px-3 py-3 dark:border-slate-700 dark:bg-slate-800/70"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-sm font-bold text-primary-700">
              {member.name.charAt(0).toUpperCase()}
            </span>
            <span className="text-sm font-semibold text-gray-800 dark:text-slate-100">{member.name}</span>
            <span className="ml-auto rounded-full bg-white px-2.5 py-1 text-xs font-medium text-gray-500 dark:bg-slate-900 dark:text-slate-400">
              {member.role === 'child' ? t('p1.roleChild') : t('p1.roleParent')}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-col gap-2">
        {showAddChild ? (
          <form onSubmit={handleAddChild} className="flex items-center gap-2">
            <input
              type="text"
              value={newChildName}
              onChange={(event) => setNewChildName(event.target.value)}
              placeholder={t('s4.placeholder')}
              aria-label={t('s4.label')}
              className="min-h-11 flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
            <Button type="submit" disabled={!newChildName.trim()}>
              {t('p1.addChild')}
            </Button>
          </form>
        ) : (
          <Button variant="secondary" onClick={() => setShowAddChild(true)} disabled={creating}>
            {t('p1.addChild')}
          </Button>
        )}
        <Button variant="secondary" onClick={handleInvite}>
          {t('p1.inviteParent')}
        </Button>
      </div>

      {showAdultInvite && (
        <div className="mt-4">
          <AdultInviteCard defaultRole="parent" onClose={() => setShowAdultInvite(false)} />
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3 min-[400px]:flex-row min-[400px]:items-center">
        <Button variant="secondary" onClick={onFinish ?? goNext} disabled={creating}>
          {t('p1.skip')}
        </Button>
        <Button size="lg" className="flex-1" onClick={onFinish ?? goNext} disabled={creating}>
          {t('p1.continue')}
        </Button>
      </div>
    </OnboardingCard>
  );
}
