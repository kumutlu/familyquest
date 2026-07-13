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

vi.mock('../store/useStore', () => ({
  useStore: () => store.state,
}));
vi.mock('../components/parent/ParentDashboard', () => ({
  ParentDashboard: () => <div>Parent Console</div>,
}));

import { Dashboard } from './Dashboard';

describe('Dashboard role routing', () => {
  beforeEach(() => {
    store.state = {
      currentUser: { id: 'owner-1', familyId: 'family-1', role: 'owner', displayName: 'Kemal' },
      feed: [],
      loading: false,
    };
  });

  it.each(['parent', 'owner'])('shows the parent console for the %s role', role => {
    store.state.currentUser.role = role;

    render(<MemoryRouter><Dashboard /></MemoryRouter>);

    expect(screen.getByText('Parent Console')).toBeInTheDocument();
    expect(screen.queryByText('Total Points')).not.toBeInTheDocument();
  });
});
