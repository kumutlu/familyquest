import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GoogleButton } from './GoogleButton';

describe('GoogleButton', () => {
  it('renders the Google brand mark and the supplied label', () => {
    render(<GoogleButton>Continue with Google</GoogleButton>);
    const btn = screen.getByRole('button', { name: /continue with google/i });
    expect(btn).toBeInTheDocument();

    // Google identity/logo treatment: the four-colour brand SVG is present.
    const svg = btn.querySelector('svg');
    expect(svg).toBeTruthy();
    const fills = [...(svg?.querySelectorAll('path') ?? [])].map((p) => p.getAttribute('fill'));
    expect(fills).toEqual(expect.arrayContaining(['#4285F4', '#34A853', '#FBBC05', '#EA4335']));

    // Neutral, white, bordered treatment (not a primary-colour button).
    expect(btn.className).toMatch(/bg-white/);
    expect(btn.className).toMatch(/border-gray-300/);
  });

  it('forwards onClick and reflects disabled', async () => {
    const onClick = vi.fn();
    render(
      <GoogleButton onClick={onClick} disabled>
        Sign in with Google
      </GoogleButton>,
    );
    const btn = screen.getByRole('button', { name: /sign in with google/i });
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});
