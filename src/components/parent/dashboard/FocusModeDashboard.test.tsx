import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../../i18n/config';

const state = vi.hoisted(() => ({
  currentUser: null as any,
  familyMembers: [] as any[],
  familyData: null as any,
  rewards: [] as any[],
  tasks: [] as any[],
  joinRequests: [] as any[],
  loading: false,
  bootstrapError: null as any,
  appReady: true,
  familyLoading: false,
  bootstrapStatus: 'ready',
}));
const navigate = vi.hoisted(() => vi.fn());

vi.mock('../../../store/useStore', () => ({
  useStore: (selector: any) => (typeof selector === 'function' ? selector(state) : state),
}));
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

import { FocusModeDashboard } from './FocusModeDashboard';

const owner = { id: 'owner', uid: 'owner', role: 'owner', displayName: 'Kemal Yilmaz', familyId: 'fam1' };
const child = { id: 'kid', role: 'child', displayName: 'Ada' };

const renderFocus = (onAddChild?: () => void) =>
  render(
    <MemoryRouter>
      <FocusModeDashboard onAddChild={onAddChild} />
    </MemoryRouter>,
  );

beforeEach(async () => {
  vi.clearAllMocks();
  state.currentUser = owner;
  state.familyMembers = [owner];
  state.familyData = { inviteCode: 'ABC123' };
  state.rewards = [];
  state.tasks = [];
  state.joinRequests = [];
  await i18n.loadNamespaces(['dashboard', 'family', 'common', 'settings']);
  await i18n.changeLanguage('en');
});

describe('FocusModeDashboard', () => {
  it('shows the welcome card, one primary CTA and human readable progress', () => {
    renderFocus();

    expect(screen.getByText(/Let's get your family ready\./)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Invite or add your first child' })).toBeInTheDocument();
    expect(screen.getByText('This usually takes less than 30 seconds.')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('exposes exactly one primary CTA for the add-child step', () => {
    renderFocus();
    expect(screen.getAllByRole('button', { name: 'Add your first child' })).toHaveLength(1);
  });

  it('opens the existing Add Child flow from the primary CTA', async () => {
    const onAddChild = vi.fn();
    const user = userEvent.setup();
    renderFocus(onAddChild);
    await user.click(screen.getByRole('button', { name: 'Add your first child' }));
    expect(onAddChild).toHaveBeenCalledTimes(1);
  });

  it('shows the waiting state with the invite flow and no primary CTA', () => {
    state.joinRequests = [{ id: 'jr1', status: 'pending', displayName: 'Ada' }];
    renderFocus();

    expect(screen.getByRole('heading', { name: 'Waiting for your child to join' })).toBeInTheDocument();
    // The invite flow starts from the role choice — never from a raw code.
    expect(screen.getByRole('heading', { name: 'Invite someone' })).toBeInTheDocument();
    expect(screen.queryByText('ABC123')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add your first child' })).not.toBeInTheDocument();
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument();
  });

  it('guides to the first reward once a child exists', () => {
    state.familyMembers = [owner, child];
    renderFocus();
    expect(screen.getByRole('heading', { name: 'Create your first reward' })).toBeInTheDocument();
    expect(screen.getByText('Step 3 of 4')).toBeInTheDocument();
  });

  it('guides to the first task once a reward exists', () => {
    state.familyMembers = [owner, child];
    state.rewards = [{ id: 'r1' }];
    renderFocus();
    expect(screen.getByRole('heading', { name: 'Create your first task' })).toBeInTheDocument();
    expect(screen.getByText('Step 4 of 4')).toBeInTheDocument();
  });

  it('renders nothing once setup is complete', () => {
    state.familyMembers = [owner, child];
    state.rewards = [{ id: 'r1' }];
    state.tasks = [{ id: 't1' }];
    const { container } = renderFocus();
    expect(container).toBeEmptyDOMElement();
  });
});
