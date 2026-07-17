import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  state: {
    currentUser: { id: 'owner-1', familyId: 'family-1', role: 'owner', displayName: 'Kemal' },
    feed: [],
    loading: false,
  } as any,
}));

vi.mock('../store/useStore', () => ({ useStore: () => store.state }));
vi.mock('../components/parent/ParentDashboard', () => ({ ParentDashboard: () => <div>Parent Dashboard View</div> }));

import { Dashboard } from './Dashboard';

describe('Dashboard role routing', () => {
  beforeEach(() => {
    store.state = {
      currentUser: { id: 'owner-1', familyId: 'family-1', role: 'owner', displayName: 'Kemal' },
      feed: [],
      loading: false,
    };
  });

  it.each(['parent', 'owner'])('shows the parent dashboard for the %s role', role => {
    store.state.currentUser.role = role;
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByText('Parent Dashboard View')).toBeInTheDocument();
    expect(screen.queryByText('Total Points')).not.toBeInTheDocument();
  });

  it('shows the child dashboard for the child role (no parent quick actions)', () => {
    store.state.currentUser.role = 'child';
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.queryByText('Parent Dashboard View')).not.toBeInTheDocument();
    expect(screen.queryByText('New Task')).not.toBeInTheDocument();
    expect(screen.getByText('Total Points')).toBeInTheDocument();
  });

  it('treats the legacy admin role as a parent (isParentRole, not strict parent)', () => {
    store.state.currentUser.role = 'admin';
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByText('Parent Dashboard View')).toBeInTheDocument();
  });
});
