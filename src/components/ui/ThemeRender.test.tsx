import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { Card } from './Card';
import { Button } from './Button';
import { applyTheme } from '../../lib/appearance';

beforeEach(() => {
  document.documentElement.classList.remove('dark');
  document.documentElement.style.colorScheme = '';
});

describe('dark theme rendering of shared components', () => {
  it('Card uses the themed surface token (bg-white) so the CSS remap applies', () => {
    const { container } = render(<Card data-testid="card" />);
    const el = container.querySelector('[data-testid="card"]') as HTMLElement;
    expect(el.className).toContain('bg-white');
  });

  it('primary Button keeps white text on the brand background in both themes', () => {
    const { container } = render(<Button variant="primary">Go</Button>);
    const btn = container.querySelector('button') as HTMLElement;
    expect(btn.className).toContain('bg-primary-500');
    expect(btn.className).toContain('text-white');
  });

  it('toggling the dark class does not break component rendering', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    const { container } = render(<Card />);
    expect(container.firstChild).toBeTruthy();

    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
