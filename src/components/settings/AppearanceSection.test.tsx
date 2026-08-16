import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppearanceSection } from './AppearanceSection';
import { useAppearanceStore, disposeAppearance } from '../../store/appearanceStore';
import { APPEARANCE_STORAGE_KEY } from '../../lib/appearance';

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
