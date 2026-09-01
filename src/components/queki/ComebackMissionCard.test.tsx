import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';
import { ComebackMissionCard } from './ComebackMissionCard';

function wrap(node: React.ReactNode) {
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}

describe('ComebackMissionCard', () => {
  it('renders nothing when the tier is "none"', () => {
    const { container } = render(wrap(
      <ComebackMissionCard tier="none" inactivityDays={0} missionCompleted={false} />,
    ));
    expect(container.firstChild).toBeNull();
  });

  it('renders the active mission card for return_3d', () => {
    render(wrap(
      <ComebackMissionCard tier="return_3d" inactivityDays={3} missionCompleted={false} />,
    ));
    expect(screen.getByTestId('comeback-mission-card')).toHaveAttribute(
      'data-comeback-tier',
      'return_3d',
    );
    expect(screen.getByTestId('comeback-mission-card')).toHaveAttribute(
      'data-comeback-completed',
      '0',
    );
  });

  it('renders the completed card when the mission has been completed today', () => {
    render(wrap(
      <ComebackMissionCard tier="return_7d" inactivityDays={9} missionCompleted={true} />,
    ));
    expect(screen.getByTestId('comeback-mission-card')).toHaveAttribute(
      'data-comeback-completed',
      '1',
    );
  });
});