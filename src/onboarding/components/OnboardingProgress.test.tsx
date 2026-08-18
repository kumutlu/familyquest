import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OnboardingProgress } from './OnboardingProgress';

describe('OnboardingProgress', () => {
  it('marks the current step with aria-current and announces via live region', () => {
    render(<OnboardingProgress current={3} total={7} />);
    const active = screen.getByRole('listitem', { current: 'step' });
    expect(active).toBeInTheDocument();
    expect(screen.getByText('Step 3 of 7')).toBeInTheDocument();
  });

  it('renders the correct number of segments', () => {
    const { container } = render(<OnboardingProgress current={1} total={7} />);
    expect(container.querySelectorAll('li')).toHaveLength(7);
  });

  it('clamps an out-of-range current value', () => {
    render(<OnboardingProgress current={99} total={7} />);
    expect(screen.getByText('Step 7 of 7')).toBeInTheDocument();
  });
});
