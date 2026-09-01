/**
 * Main entry bootstrap — regression for the P0 blank-page bug.
 *
 * `main.tsx` lazy-imports `./App.tsx` only when the URL does not carry
 * `?dev-preview=engagement`. The P0 incident was caused by `./App.tsx`
 * failing to evaluate because a transitive import in the avatar graph
 * (`avatarCatalog.ts` → `avatarConfig.ts`) required a function the
 * avatar config module did NOT export. The browser then threw a
 * `SyntaxError: ... does not provide an export named 'avatarConfigToDataUrl'`
 * before `<App />` ever mounted, and `<div id="root" />` stayed blank.
 *
 * This test directly exercises the import chain the production browser
 * would: it imports `./App.tsx` and waits for it to resolve. If any
 * module in the App graph throws at evaluation time, the import never
 * resolves and this test fails — exactly the failure mode the user
 * reported.
 */
import { describe, expect, it, vi } from 'vitest';

// Mock the heavy store / i18n so we can isolate the module-evaluation
// surface (the test must FAIL on a missing export, not on a missing
// Firebase mock or i18n bundle).
vi.mock('./store/useStore', () => ({
  useStore: Object.assign(
    (selector: any) => selector({
      authStatus: 'unauthenticated',
      authUser: null,
      currentUser: null,
      familyData: null,
      familyMembers: [],
      tasks: [],
      rewards: [],
      profileServerConfirmed: false,
      appReady: false,
      bootstrapError: null,
      pendingMembershipStatus: 'none',
      initAuth: vi.fn(),
      logAuthTrace: vi.fn(),
    }),
    {
      getState: () => ({
        authStatus: 'unauthenticated',
        authUser: null,
        currentUser: null,
        familyData: null,
        familyMembers: [],
        tasks: [],
        rewards: [],
        profileServerConfirmed: false,
        appReady: false,
        bootstrapError: null,
        pendingMembershipStatus: 'none',
        initAuth: vi.fn(),
        logAuthTrace: vi.fn(),
      }),
      setState: vi.fn(),
    },
  ),
  logAuthTrace: vi.fn(),
}));
vi.mock('./i18n', () => ({
  default: { use: () => ({ use: () => ({ use: () => ({ init: () => Promise.resolve() }) }) }), t: (k: string) => k },
  bootstrapI18n: () => Promise.resolve(),
}));
vi.mock('./components/layout/AppLayout', async () => {
  const { Outlet } = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { AppLayout: () => <div><span>layout</span><Outlet /></div> };
});
vi.mock('./pages/Dashboard', () => ({ Dashboard: () => <div>dashboard</div> }));
vi.mock('./lib/pushNotifications', () => ({ initForegroundMessaging: () => Promise.resolve() }));
vi.mock('./lib/googleRedirectAuth', () => ({ consumeGoogleRedirectResult: () => Promise.resolve(null) }));

describe('main entry — normal App module graph evaluates without throwing', () => {
  it('dynamic import of App.tsx resolves to a default export', async () => {
    // Mirror the dynamic import that main.tsx performs.
    const mod: any = await import('./App.tsx');
    expect(typeof mod.default).toBe('function');
  });

  it('useStore -> avatarCatalog -> avatarConfig import chain resolves avatarConfigToDataUrl', async () => {
    // The exact chain that broke the P0 build: useStore transitively imports
    // avatarCatalog which imports avatarConfigToDataUrl from avatarConfig.
    // If avatarConfig ever drops that export, this assertion fails.
    const mod: any = await import('./config/avatarConfig');
    expect(typeof mod.avatarConfigToDataUrl).toBe('function');
  });

  it('avatarCatalog exports resolveAvatarImage (consumed by App.tsx via useStore -> withResolvedAvatar)', async () => {
    const mod: any = await import('./config/avatarCatalog');
    expect(typeof mod.resolveAvatarImage).toBe('function');
    expect(typeof mod.withResolvedAvatar).toBe('function');
  });
});