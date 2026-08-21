import { useStore } from '../store/useStore';

export function E2EBootstrapDiagnostics() {
  const authStatus = useStore(value => value.authStatus);
  const profileLoading = useStore(value => value.profileLoading);
  const profileServerConfirmed = useStore(value => value.profileServerConfirmed);
  const familyLoading = useStore(value => value.familyLoading);
  const appReady = useStore(value => value.appReady);
  const bootstrapError = useStore(value => value.bootstrapError);
  if (import.meta.env.VITE_USE_FIREBASE_EMULATOR !== 'true') return null;
  let onboardingDraftStep: string | null = null;
  try {
    const raw = sessionStorage.getItem('queki.onboardingDraft') || localStorage.getItem('queki.onboardingDraft');
    onboardingDraftStep = raw ? JSON.parse(raw).step ?? null : null;
  } catch { /* diagnostics must never affect the app */ }
  return (
    <output data-testid="e2e-bootstrap-state" hidden>
      {JSON.stringify({ authStatus, profileLoading, profileServerConfirmed, familyLoading, appReady, bootstrapError, onboardingDraftStep })}
    </output>
  );
}
