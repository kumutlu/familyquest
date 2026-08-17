import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppearanceSection } from './AppearanceSection';
import { useAppearanceStore, disposeAppearance } from '../../store/appearanceStore';
import { APPEARANCE_STORAGE_KEY } from '../../lib/appearance';
// Raw sources: the availability contract below is structural (is the control
// role-gated?), which is cheaper and more stable to assert on the source than to
// mount the whole Settings page with four different sessions.
import componentSource from './AppearanceSection.tsx?raw';
import settingsSource from '../../pages/Settings.tsx?raw';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  document.documentElement.style.colorScheme = '';
  useAppearanceStore.setState({
    appearance: 'system',
    systemDark: false,
    resolvedTheme: 'light',
    initialized: false,
  });
  disposeAppearance();
});

describe('AppearanceSection', () => {
  it('renders an accessible radiogroup with three options', () => {
    render(<AppearanceSection />);
    expect(screen.getByRole('radiogroup', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /System/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Light/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Dark/ })).toBeInTheDocument();
  });

  it('reflects the current preference (default System is checked)', () => {
    render(<AppearanceSection />);
    expect(screen.getByRole('radio', { name: /System/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Light/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: /Dark/ })).toHaveAttribute('aria-checked', 'false');
  });

  it('selecting Dark applies the dark class and persists the choice', async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    await user.click(screen.getByRole('radio', { name: /Dark/ }));
    expect(screen.getByRole('radio', { name: /Dark/ })).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe('dark');
  });

  it('supports arrow-key navigation and selection', async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    const system = screen.getByRole('radio', { name: /System/ });
    system.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: /Light/ })).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});

/**
 * Appearance is a per-device preference: there is no product reason to hide it
 * from any role. These checks pin that contract so a future refactor cannot
 * accidentally put the control behind a parent/owner guard (the release
 * specification requires Settings → Appearance for owner, parent, adult and
 * child alike). The runtime counterpart lives in
 * `tests/e2e/appearance-dark.spec.ts`, which opens Profile → Settings for each
 * seeded role.
 */
describe('AppearanceSection — availability for every role', () => {
  it('does not read the member role, so it renders identically for owner/parent/adult/child', () => {
    // ARIA `role="..."` attributes are expected and must NOT trip this check;
    // we only care about role-GATING logic (e.g. `role === 'child'`,
    // `currentUser.role`, `isChildRole`).
    expect(componentSource).not.toMatch(/role\s*===|currentUser\??\.role|isChildRole/);
  });

  it('is mounted unconditionally by the Settings page', () => {
    const line = settingsSource
      .split('\n')
      .find((candidate) => candidate.includes('<AppearanceSection'));
    expect(line, 'Settings no longer renders <AppearanceSection />').toBeDefined();
    // A guard would appear as `{cond && <AppearanceSection />}` or a ternary.
    expect(line as string).not.toMatch(/&&|\?/);
    expect((line as string).trim()).toBe('<AppearanceSection />');
  });

  it('renders the three options regardless of who is signed in', () => {
    render(<AppearanceSection />);
    expect(screen.getByRole('radiogroup', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });
});
