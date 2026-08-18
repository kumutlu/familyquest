import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MiniJourney } from './MiniJourney';

// The mini-journey is purely presentational. It must never perform real writes.
vi.mock('../../lib/api', () => ({
  createTask: vi.fn(),
  createManagedMember: vi.fn(),
}));

describe('MiniJourney', () => {
  it('conveys the core loop with text (no motion required)', () => {
    render(<MiniJourney childName="Osman" />);
    // The child's name appears in the personalised steps…
    expect(screen.getAllByText(/Osman/i).length).toBeGreaterThan(0);
    // …and the mental model is stated explicitly, so it is understood without animation.
    expect(screen.getByText(/Task → .* completes → you approve → points → reward/i)).toBeInTheDocument();
  });

  it('falls back to a generic label when no child name is provided', () => {
    render(<MiniJourney childName="" />);
    expect(screen.getAllByText(/your child/i).length).toBeGreaterThan(0);
  });
});
