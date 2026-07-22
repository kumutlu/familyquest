import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ChildSummaryCard } from './ChildSummaryCard';

const child = {
  id: 'c1',
  displayName: 'Muhammed Osman',
  lifetimeXP: 4000,
  rewardPoints: 245,
  currentStreak: 12,
  // Legacy profile field that must be ignored by the card.
  walletBalance: 99999,
};

describe('ChildSummaryCard', () => {
  it('uses the canonical wallet balance and ignores the legacy walletBalance', () => {
    render(
      <MemoryRouter>
        <ChildSummaryCard child={child} walletBalance={2720} pendingTaskCount={0} />
      </MemoryRouter>,
    );
    // 2720 pence = £27.20 (canonical)
    expect(screen.getByText('£27.20')).toBeInTheDocument();
    // Legacy 99999 pence = £999.99 must NOT appear.
    expect(screen.queryByText('£999.99')).not.toBeInTheDocument();
    expect(screen.getByText('245')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Level 5')).toBeInTheDocument();
  });

  it('shows Unavailable instead of a false £0 when the canonical wallet is missing', () => {
    render(
      <MemoryRouter>
        <ChildSummaryCard child={child} walletBalance={null} pendingTaskCount={0} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText('£0.00')).not.toBeInTheDocument();
  });

  it('links to the child profile and shows the pending task count', () => {
    render(
      <MemoryRouter>
        <ChildSummaryCard child={child} walletBalance={2720} pendingTaskCount={2} />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: /View Muhammed Osman[’']s profile/i });
    expect(link).toHaveAttribute('href', '/family/c1');
    expect(screen.getByText(/2 pending tasks/)).toBeInTheDocument();
  });
});
