import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ current: {} as any }));
vi.mock('../../../store/useStore', () => ({ useStore: () => state.current }));
vi.mock('../../../lib/roles', () => ({ isChildRole: (role: string) => role === 'child' }));

import { ChildrenOverview } from './ChildrenOverview';

describe('ChildrenOverview', () => {
  it('renders a card per active child using the canonical balance', () => {
    state.current = {
      familyMembers: [
        { id: 'c1', displayName: 'Ada', role: 'child', lifetimeXP: 0, rewardPoints: 10, currentStreak: 3 },
        { id: 'c2', displayName: 'Ben', role: 'child', lifetimeXP: 0, rewardPoints: 20, currentStreak: 5 },
        { id: 'p1', displayName: 'Parent', role: 'parent' },
      ],
      childWallets: [{ id: 'c1', balance: 1234 }, { id: 'c2', balance: 5678 }],
      tasks: [], taskCompletions: [],
      bootstrapStatus: { wallets: 'ready' },
    };
    render(<MemoryRouter><ChildrenOverview /></MemoryRouter>);
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Ben')).toBeInTheDocument();
    expect(screen.getByText('£12.34')).toBeInTheDocument();
    expect(screen.getByText('£56.78')).toBeInTheDocument();
    expect(screen.queryByText('Parent')).not.toBeInTheDocument();
  });

  it('shows a skeleton while wallets load and never a false £0 balance', () => {
    state.current = {
      familyMembers: [{ id: 'c1', displayName: 'Ada', role: 'child' }],
      childWallets: [{ id: 'c1', balance: 0 }],
      tasks: [], taskCompletions: [],
      bootstrapStatus: { wallets: 'loading' },
    };
    const { container } = render(<MemoryRouter><ChildrenOverview /></MemoryRouter>);
    expect(screen.queryByText('£0.00')).not.toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders nothing when there are no children', () => {
    state.current = {
      familyMembers: [{ id: 'p1', displayName: 'Parent', role: 'parent' }],
      childWallets: [], tasks: [], taskCompletions: [],
      bootstrapStatus: { wallets: 'ready' },
    };
    const { container } = render(<MemoryRouter><ChildrenOverview /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
