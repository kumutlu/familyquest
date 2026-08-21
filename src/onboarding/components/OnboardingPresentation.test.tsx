import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { House } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { OnboardingActions } from './OnboardingActions';
import { OnboardingChoiceCard } from './OnboardingChoiceCard';
import { OnboardingShell } from './OnboardingShell';
import { OnboardingVisual } from './OnboardingVisual';
import {
  ChildJoinScene,
  FamilyHomeScene,
  FamilyMembersScene,
  JourneyScene,
  ManualJoinScene,
  SuccessScene,
} from '../visuals/OnboardingScenes';
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
    expect(screen.getByTestId('onboarding-shell')).toHaveClass('overflow-x-hidden');
    expect(screen.getByTestId('onboarding-shell')).not.toHaveClass('overflow-hidden');
    expect(screen.getByTestId('onboarding-visual-region')).toHaveClass('lg:w-[45%]');
    expect(screen.getByTestId('onboarding-content-region')).toHaveClass('lg:w-[55%]');
    expect(screen.getByRole('img', { name: 'A family home' })).toBeInTheDocument();
  });

  it('keeps compact mobile content directly below its visual while retaining desktop centering', () => {
    render(
      <OnboardingShell compact visual={<ChildJoinScene label="Child joins" />}>
        <h1>Child name</h1>
      </OnboardingShell>,
    );

    expect(screen.getByTestId('onboarding-content-region')).toHaveClass('justify-start', 'lg:justify-center');
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
    expect(choice).toHaveClass('min-h-14');
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

  it('uses the same fixed Queki family characters across the onboarding story', () => {
    render(
      <>
        <FamilyHomeScene label="Welcome" />
        <ChildJoinScene label="A child joins" />
        <FamilyMembersScene label="The household grows" />
        <SuccessScene label="Setup complete" />
        <ManualJoinScene label="Join a household" />
      </>,
    );

    expect(screen.getAllByTestId('queki-parent-token')).toHaveLength(4);
    expect(screen.getAllByTestId('queki-child-token')).toHaveLength(5);
    expect(screen.getByTestId('queki-add-member-token')).toBeInTheDocument();
    for (const token of [...screen.getAllByTestId('queki-parent-token'), ...screen.getAllByTestId('queki-child-token')]) {
      expect(token).toHaveClass('absolute');
      expect(token).not.toHaveClass('relative');
    }
  });

  it('shows the product-accurate task, approval, points, and reward progression', () => {
    render(<JourneyScene label="Task to reward journey" />);

    expect(screen.getByTestId('journey-task')).toBeInTheDocument();
    expect(screen.getByTestId('journey-approval')).toBeInTheDocument();
    expect(screen.getByTestId('journey-points')).toBeInTheDocument();
    expect(screen.getByTestId('journey-reward')).toBeInTheDocument();
    expect(screen.queryByText(/£|cash/i)).not.toBeInTheDocument();
  });

  it('keeps the child, household, and first-task scenes compact on mobile without changing desktop height', () => {
    render(
      <>
        <ChildJoinScene label="Child name" />
        <FamilyMembersScene label="Family composition" />
        <JourneyScene label="First task" />
      </>,
    );

    for (const label of ['Child name', 'Family composition', 'First task']) {
      expect(screen.getByRole('img', { name: label })).toHaveClass('h-36', 'sm:h-64', 'lg:h-80');
    }

    const household = screen.getByRole('img', { name: 'Family composition' });
    const additionalMember = household.querySelector('.from-teal-400');
    expect(additionalMember).toHaveClass('absolute');
    expect(additionalMember).not.toHaveClass('relative');
  });

  it('keeps scene internals decorative and reduced-motion complete', () => {
    render(<SuccessScene label="Family setup complete" />);

    const scene = screen.getByRole('img', { name: 'Family setup complete' });
    expect(scene).toHaveClass('motion-reduce:animate-none');
    expect(scene.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(3);
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

  it('can expose a compact visual story on mobile join screens', () => {
    render(
      <PublicAuthShell
        visual={<FamilyHomeScene label="Desktop family" />}
        mobileVisual={<ManualJoinScene label="Mobile family code journey" />}
        visualTitle="Join Queki"
      >
        <h1>Family code</h1>
      </PublicAuthShell>,
    );

    expect(screen.getByTestId('public-auth-mobile-visual')).toHaveClass('lg:hidden');
    expect(screen.getByRole('img', { name: 'Mobile family code journey' })).toBeInTheDocument();
  });
});
