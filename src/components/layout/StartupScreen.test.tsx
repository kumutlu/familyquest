import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import i18n from '../../i18n/config';
import {
  StartupScreen,
  STARTUP_REASSURANCE_DELAY_MS,
  STARTUP_TIMEOUT_MS,
} from './StartupScreen';

const advance = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
};

describe('StartupScreen', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('1. shows the bilingual preparing message during the initial auth check', () => {
    render(<StartupScreen phase="auth" onRetry={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Preparing your family dashboard…');
  });

  it('2. shows the Turkish preparing message when the language is Turkish', async () => {
    await act(async () => {
      await i18n.changeLanguage('tr');
    });
    render(<StartupScreen phase="family" onRetry={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Aile paneliniz hazırlanıyor…');
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('3. never fabricates a progress percentage', () => {
    const { container } = render(<StartupScreen phase="profile" onRetry={vi.fn()} />);
    expect(container.textContent).not.toMatch(/\d+\s?%/);
    expect(container.querySelector('progress')).toBeNull();
  });

  it('4. shows a secondary reassurance message only after a delay', async () => {
    render(<StartupScreen phase="auth" onRetry={vi.fn()} />);
    expect(screen.queryByTestId('startup-reassurance')).not.toBeInTheDocument();
    await advance(STARTUP_REASSURANCE_DELAY_MS);
    expect(screen.getByTestId('startup-reassurance')).toBeInTheDocument();
  });

  it('5. surfaces a recoverable error with a Retry action instead of loading forever', async () => {
    const onRetry = vi.fn();
    render(<StartupScreen phase="error" error="[Profile] not-found" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await act(async () => {
      screen.getByRole('button', { name: 'Retry' }).click();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('6. REGRESSION: a startup that never resolves times out instead of loading forever', async () => {
    render(<StartupScreen phase="family" onRetry={vi.fn()} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    await advance(STARTUP_TIMEOUT_MS);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('taking longer than expected');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Connection problem');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('7. offers Sign out alongside Retry once a user is signed in', async () => {
    const onSignOut = vi.fn();
    render(<StartupScreen phase="profile" onRetry={vi.fn()} onSignOut={onSignOut} />);
    await advance(STARTUP_TIMEOUT_MS);
    await act(async () => {
      screen.getByRole('button', { name: 'Sign out' }).click();
    });
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('8. omits Sign out when no session can be ended', async () => {
    render(<StartupScreen phase="auth" onRetry={vi.fn()} />);
    await advance(STARTUP_TIMEOUT_MS);
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
  });

  it('9. retrying after a timeout restarts the loading state and its timers', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<StartupScreen phase="family" onRetry={onRetry} />);
    await advance(STARTUP_TIMEOUT_MS);
    await act(async () => {
      screen.getByRole('button', { name: 'Retry' }).click();
    });
    expect(onRetry).toHaveBeenCalled();
    rerender(<StartupScreen phase="auth" onRetry={onRetry} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('10. a delayed but successful auth resolution clears the loading screen before the timeout', async () => {
    const { rerender } = render(<StartupScreen phase="auth" onRetry={vi.fn()} />);
    await advance(STARTUP_TIMEOUT_MS - 1000);
    rerender(<StartupScreen phase="ready" onRetry={vi.fn()} />);
    await advance(STARTUP_TIMEOUT_MS);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('19. REGRESSION: Retry in the same phase restarts the timers via the attempt token', async () => {
    const { rerender } = render(<StartupScreen phase="family" attempt={0} onRetry={vi.fn()} />);
    await advance(STARTUP_TIMEOUT_MS);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // retryBootstrap() bumps the attempt counter while the phase label stays
    // "family". The screen must return to loading and get a fresh budget.
    rerender(<StartupScreen phase="family" attempt={1} onRetry={vi.fn()} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    await advance(STARTUP_TIMEOUT_MS - 1);
    expect(screen.getByRole('status')).toBeInTheDocument();
    await advance(1);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('12. REGRESSION: a late auth success after the timeout leaves the error screen automatically', async () => {
    const { rerender } = render(<StartupScreen phase="auth" onRetry={vi.fn()} />);
    await advance(STARTUP_TIMEOUT_MS);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    rerender(<StartupScreen phase="ready" onRetry={vi.fn()} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('13. REGRESSION: a late profile success after the timeout leaves the error screen automatically', async () => {
    const { rerender } = render(<StartupScreen phase="profile" onRetry={vi.fn()} />);
    await advance(STARTUP_TIMEOUT_MS);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    rerender(<StartupScreen phase="ready" onRetry={vi.fn()} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('14. REGRESSION: a late family success after the timeout leaves the error screen automatically', async () => {
    const { rerender } = render(<StartupScreen phase="family" onRetry={vi.fn()} />);
    await advance(STARTUP_TIMEOUT_MS);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    rerender(<StartupScreen phase="ready" onRetry={vi.fn()} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('15. REGRESSION: an auth-phase timeout never carries into the profile phase, not even for one render', async () => {
    const { rerender } = render(<StartupScreen phase="auth" onRetry={vi.fn()} />);
    await advance(STARTUP_TIMEOUT_MS);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // Synchronous assertion: the very first render of the next phase must
    // already be a loading screen, before any effect has had a chance to run.
    rerender(<StartupScreen phase="profile" onRetry={vi.fn()} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('16. restarts the timer when the phase changes so each phase gets a full budget', async () => {
    const { rerender } = render(<StartupScreen phase="auth" onRetry={vi.fn()} />);
    await advance(STARTUP_TIMEOUT_MS - 1000);
    rerender(<StartupScreen phase="family" onRetry={vi.fn()} />);
    await advance(STARTUP_TIMEOUT_MS - 1000);
    expect(screen.getByRole('status')).toBeInTheDocument();
    await advance(1000);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('17. a genuine bootstrap error is never replaced by the generic timeout copy', async () => {
    render(<StartupScreen phase="error" error="[Family] permission-denied" onRetry={vi.fn()} />);
    await advance(STARTUP_TIMEOUT_MS * 2);
    expect(screen.getByRole('alert')).toHaveTextContent('family access');
    expect(screen.getByRole('alert')).not.toHaveTextContent('permission-denied');
    expect(screen.getByRole('alert')).not.toHaveTextContent('taking longer than expected');
  });

  it('labels retryable family validation as delayed rather than denied in English and Turkish', async () => {
    const { rerender } = render(
      <StartupScreen phase="error" error="[FamilyVerificationDelayed] unavailable: transport" onRetry={vi.fn()} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Still verifying your family');
    expect(screen.getByRole('alert')).toHaveTextContent('Your dashboard will open automatically when the connection recovers.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('family access');

    await act(async () => {
      await i18n.changeLanguage('tr');
    });
    rerender(<StartupScreen phase="error" error="[FamilyVerificationDelayed] unavailable: transport" onRetry={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Aileniz hâlâ doğrulanıyor');
    expect(screen.getByRole('alert')).not.toHaveTextContent('aile erişiminizi doğrulayamadık');
  });

  it('labels a confirmed offline timeout as a connection problem', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    render(<StartupScreen phase="family" onRetry={vi.fn()} />);
    await advance(STARTUP_TIMEOUT_MS);
    expect(screen.getByRole('alert')).toHaveTextContent('Connection problem');
  });

  it('labels an immediate bootstrap failure as offline when the browser confirms it', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    render(<StartupScreen phase="error" error="[Profile] unavailable: offline" onRetry={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Connection problem');
    expect(screen.getByRole('alert')).toHaveTextContent('You appear to be offline');
  });

  it('18. leaves no pending timers once the app becomes ready', async () => {
    const { rerender } = render(<StartupScreen phase="family" onRetry={vi.fn()} />);
    rerender(<StartupScreen phase="ready" onRetry={vi.fn()} />);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('11. clears every timeout handle on unmount', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = render(<StartupScreen phase="auth" onRetry={vi.fn()} />);
    clearSpy.mockClear();
    unmount();
    expect(clearSpy).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    clearSpy.mockRestore();
  });
});

describe('StartupScreen diagnostics', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await i18n.changeLanguage('en');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('logs AUTH_TIMEOUT when the auth phase times out', async () => {
    render(<StartupScreen phase="auth" onRetry={vi.fn()} />);
    await advance(STARTUP_TIMEOUT_MS);
    expect(console.error).toHaveBeenCalledWith('[StartupDiagnostic]', 'AUTH_TIMEOUT', { phase: 'auth' });
  });

  it('logs PROFILE_LOAD_TIMEOUT when the profile phase times out', async () => {
    render(<StartupScreen phase="profile" onRetry={vi.fn()} />);
    await advance(STARTUP_TIMEOUT_MS);
    expect(console.error).toHaveBeenCalledWith('[StartupDiagnostic]', 'PROFILE_LOAD_TIMEOUT', { phase: 'profile' });
  });

  it('logs FAMILY_LOAD_TIMEOUT when the family phase times out', async () => {
    render(<StartupScreen phase="family" onRetry={vi.fn()} />);
    await advance(STARTUP_TIMEOUT_MS);
    expect(console.error).toHaveBeenCalledWith('[StartupDiagnostic]', 'FAMILY_LOAD_TIMEOUT', { phase: 'family' });
  });

  it('does NOT log a timeout code for a genuine bootstrap error', async () => {
    render(<StartupScreen phase="error" error="[Profile] not-found" onRetry={vi.fn()} />);
    await advance(STARTUP_TIMEOUT_MS * 2);
    const calls = (console.error as any).mock.calls;
    expect(calls.some((c: unknown[]) => c[0] === '[StartupDiagnostic]')).toBe(false);
  });

  it('keeps the user-facing copy generic (no diagnostic code leaks to the UI)', async () => {
    render(<StartupScreen phase="family" onRetry={vi.fn()} />);
    await advance(STARTUP_TIMEOUT_MS);
    expect(screen.getByRole('alert')).toHaveTextContent('taking longer than expected');
    expect(screen.getByRole('alert').textContent).not.toMatch(/FAMILY_LOAD_TIMEOUT|AUTH_TIMEOUT/);
  });
});
