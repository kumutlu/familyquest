import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store/useStore';
import {
  signInWithGoogle,
  signOut,
  createFamilyAndParent,
  createManagedMember,
  createTask,
} from '../lib/api';
import { useOnboardingMachine } from './useOnboardingMachine';
import { PRE_AUTH_STEPS, POST_AUTH_STEPS } from './lib/onboardingDraft';
import { recordOnboardingEvent } from './lib/onboardingAnalytics';
import type { SetupDeps } from './lib/onboardingSetup';
import { OnboardingShell } from './components/OnboardingShell';
import { OnboardingProgress } from './components/OnboardingProgress';
import { OnboardingError } from './components/OnboardingError';
import { Step1ValueProposition } from './steps/Step1ValueProposition';
import { Step2ParentName } from './steps/Step2ParentName';
import { Step3Relationship } from './steps/Step3Relationship';
import { Step4ChildName } from './steps/Step4ChildName';
import { Step5MiniJourney } from './steps/Step5MiniJourney';
import { Step6FamilyName } from './steps/Step6FamilyName';
import { Step7Account } from './steps/Step7Account';
import { FamilyComposition } from './postauth/FamilyComposition';
import { FirstTask } from './postauth/FirstTask';
import { Success } from './postauth/Success';

const GOOGLE_CANCELLED_MESSAGE = 'Google sign-in could not be completed. Please try again.';

function BoundedLoading() {
  const { t } = useTranslation('onboarding');
  return (
    <div className="min-h-dvh flex items-center justify-center bg-gradient-to-b from-amber-50 to-white">
      <div className="text-center" role="status" aria-live="polite">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary-200 border-t-primary-500" />
        <p className="mt-3 text-sm text-gray-500">{t('loading.resuming')}</p>
      </div>
    </div>
  );
}

/**
 * Public, pre-auth onboarding container. Rendered OUTSIDE <AppLayout> so it is
 * reachable by unauthenticated visitors. It replicates the family/child guards
 * internally: an established family owner or a managed child is redirected away,
 * and an unresolved bootstrap shows bounded loading rather than accidental
 * onboarding.
 */
export function OnboardingFlow() {
  const { t } = useTranslation('onboarding');
  const navigate = useNavigate();

  const authStatus = useStore(state => state.authStatus);
  const authUser = useStore(state => state.authUser);
  const currentUser = useStore(state => state.currentUser);
  const bootstrapError = useStore(state => state.bootstrapError);
  const refreshCurrentUser = useStore(state => state.refreshCurrentUser);

  const currentFamilyId = currentUser?.familyId ?? null;
  const { draft, goNext, goBack, setStep, patch, reset } = useOnboardingMachine(currentFamilyId);

  const [localAuthError, setLocalAuthError] = useState<string | null>(null);

  const inPostAuth = POST_AUTH_STEPS.includes(draft.step);
  const postAuth = authStatus === 'authenticated' && (inPostAuth || !currentUser?.familyId);

  // Build the idempotent setup dependencies from the authoritative store + api.
  const deps = useMemo<SetupDeps>(
    () => ({
      uid: authUser?.uid ?? currentUser?.id ?? '',
      createFamilyAndParent,
      createManagedMember,
      createTask,
      refreshCurrentUser,
      getFamilyMembers: () => useStore.getState().familyMembers ?? [],
    }),
    [authUser?.uid, currentUser?.id, refreshCurrentUser],
  );

  // Funnel: started (once, pre-auth).
  const startedRef = useRef(false);
  useEffect(() => {
    if (!startedRef.current && !postAuth) {
      startedRef.current = true;
      recordOnboardingEvent('onboarding_started');
    }
  }, [postAuth]);

  // Funnel: auth completed + advance s7 → p1 when auth resolves.
  useEffect(() => {
    if (postAuth && PRE_AUTH_STEPS.includes(draft.step)) {
      recordOnboardingEvent('onboarding_auth_completed', { authProvider: draft.authProvider });
      setStep('p1');
    }
  }, [postAuth, draft.step, draft.authProvider, setStep]);

  // Funnel: family created / first task created (idempotent, fires once).
  const prevFamilyId = useRef(draft.familyId);
  useEffect(() => {
    if (draft.familyId && !prevFamilyId.current) recordOnboardingEvent('onboarding_family_created');
    prevFamilyId.current = draft.familyId;
  }, [draft.familyId]);
  const prevTaskId = useRef(draft.firstTaskId);
  useEffect(() => {
    if (draft.firstTaskId && !prevTaskId.current) recordOnboardingEvent('onboarding_first_task_created');
    prevTaskId.current = draft.firstTaskId;
  }, [draft.firstTaskId]);

  // --- Internal guards (mirror AppLayout, but for the public route) ---
  // Established family owner (or anyone who already has a family) is never
  // re-routed through onboarding — UNLESS we are actively in the post-auth
  // setup phase (draft.step in p1/p2/p3), in which case we must finish P2/P3.
  if (currentUser?.familyId && !POST_AUTH_STEPS.includes(draft.step)) {
    return <Navigate to="/" replace />;
  }
  // A managed child never enters the parent flow.
  if (currentUser?.role === 'child') {
    return <Navigate to="/" replace />;
  }
  // Unresolved bootstrap: show bounded loading, never accidental onboarding.
  if (authStatus === 'initializing') {
    return <BoundedLoading />;
  }
  // Authenticated but the profile never resolved (genuine persistent failure):
  // surface a human-readable, recoverable error — never an indefinite spinner
  // and never a raw internal string such as "User not found".
  if (authStatus === 'authenticated' && !currentUser) {
    if (bootstrapError) {
      return (
        <OnboardingShell eyebrow={t('meta.title')}>
          <OnboardingError
            title={t('errors.setupTitle')}
            message={t('errors.profileUnavailable')}
            onRetry={() => useStore.getState().retryBootstrap()}
          />
        </OnboardingShell>
      );
    }
    return <BoundedLoading />;
  }

  const authError =
    bootstrapError === GOOGLE_CANCELLED_MESSAGE ? t('errors.authCancelled') : localAuthError;

  const handleGoogle = async () => {
    patch({ authProvider: 'google' });
    recordOnboardingEvent('onboarding_auth_started', { authProvider: 'google' });
    setLocalAuthError(null);
    try {
      await signInWithGoogle();
      // Desktop popup resolves here; mobile redirects (page reloads and the
      // effect above advances to p1 once authStatus becomes authenticated).
    } catch {
      setLocalAuthError(t('errors.authFailed'));
    }
  };

  const handleEmail = () => {
    patch({ authProvider: 'email' });
    recordOnboardingEvent('onboarding_auth_started', { authProvider: 'email' });
    // Return to onboarding after signup so the post-auth setup (P1–P3) resumes.
    navigate('/signup?next=/onboarding');
  };

  const handleFinish = () => {
    recordOnboardingEvent('onboarding_completed');
    reset();
    navigate('/', { replace: true });
  };

  const progress = inPostAuth ? (
    <OnboardingProgress
      current={POST_AUTH_STEPS.indexOf(draft.step) + 1}
      total={POST_AUTH_STEPS.length}
      labelKey="meta.continuationLabel"
    />
  ) : (
    <OnboardingProgress current={PRE_AUTH_STEPS.indexOf(draft.step) + 1} total={PRE_AUTH_STEPS.length} />
  );

  const renderStep = () => {
    switch (draft.step) {
      case 's1':
        return <Step1ValueProposition onNext={goNext} onLogin={() => navigate('/login')} />;
      case 's2':
        return (
          <Step2ParentName draft={draft} patch={patch} onNext={goNext} onSignOut={() => void signOut()} />
        );
      case 's3':
        return <Step3Relationship draft={draft} patch={patch} onNext={goNext} onBack={goBack} />;
      case 's4':
        return <Step4ChildName draft={draft} patch={patch} onNext={goNext} onBack={goBack} />;
      case 's5':
        return <Step5MiniJourney draft={draft} onNext={goNext} onBack={goBack} />;
      case 's6':
        return <Step6FamilyName draft={draft} patch={patch} onNext={goNext} onBack={goBack} />;
      case 's7':
        return (
          <Step7Account
            draft={draft}
            onGoogle={handleGoogle}
            onEmail={handleEmail}
            authError={authError}
            onStartOver={reset}
            onBack={goBack}
          />
        );
      case 'p1':
        return <FamilyComposition draft={draft} patch={patch} goNext={goNext} deps={deps} />;
      case 'p2':
        return <FirstTask draft={draft} patch={patch} goNext={goNext} goBack={goBack} deps={deps} />;
      case 'p3':
        return <Success draft={draft} onFinish={handleFinish} />;
      default:
        return null;
    }
  };

  return (
    <OnboardingShell eyebrow={t('meta.title')} progress={progress}>
      {renderStep()}
    </OnboardingShell>
  );
}
