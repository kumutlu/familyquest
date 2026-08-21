import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { House } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { OnboardingActions } from './OnboardingActions';
import { OnboardingChoiceCard } from './OnboardingChoiceCard';
import { OnboardingShell } from './OnboardingShell';
import { OnboardingVisual } from './OnboardingVisual';
import { FamilyHomeScene, JourneyScene, SuccessScene } from '../visuals/OnboardingScenes';
import { PublicAuthShell } from './PublicAuthShell';

describe('onboarding presentation system', () => {
  it('exposes distinct visual and content regions in a responsive shell', () => {
    render(
      <OnboardingShell
        eyebrow="Queki"
        visual={<OnboardingVisual title="A family home"><House /></OnboardingVisual>}
      >
        <h1>Welcome home</h1>
      </OnboardingShell>,
    );

    expect(screen.getByTestId('onboarding-shell')).toHaveClass('dark:bg-slate-950');
    expect(screen.getByTestId('onboarding-visual-region')).toHaveClass('lg:w-[45%]');
    expect(screen.getByTestId('onboarding-content-region')).toHaveClass('lg:w-[55%]');
    expect(screen.getByRole('img', { name: 'A family home' })).toBeInTheDocument();
  });

  it('renders a large semantic radio choice and reports selection', async () => {
    const onSelect = vi.fn();
    render(
      <OnboardingChoiceCard
        label="Parent"
        description="Manages the family"
        icon={<House />}
        selected={false}
        onSelect={onSelect}
      />,
    );

    const choice = screen.getByRole('radio', { name: /Parent/ });
    expect(choice).toHaveClass('min-h-16');
    await userEvent.click(choice);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('lays out primary and secondary actions without changing their callbacks', async () => {
    const primary = vi.fn();
    const secondary = vi.fn();
    render(
      <OnboardingActions
        primary={<button onClick={primary}>Continue</button>}
        secondary={<button onClick={secondary}>Back</button>}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(primary).toHaveBeenCalledOnce();
    expect(secondary).toHaveBeenCalledOnce();
  });

  it('provides meaningful labels for code-native scenes without relying on motion', () => {
    render(
      <>
        <FamilyHomeScene label="A family growing together" />
        <JourneyScene label="Task to reward journey" />
        <SuccessScene label="Family setup complete" />
      </>,
    );
    expect(screen.getByRole('img', { name: 'A family growing together' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Task to reward journey' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Family setup complete' })).toBeInTheDocument();
  });

  it('gives public auth and join pages the same responsive split composition', () => {
    render(
      <PublicAuthShell visual={<FamilyHomeScene label="Family" />} visualTitle="Welcome to Queki">
        <h1>Sign in</h1>
      </PublicAuthShell>,
    );
    expect(screen.getByTestId('public-auth-shell')).toHaveClass('lg:grid-cols-[45%_55%]');
    expect(screen.getByText('Welcome to Queki')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});
