import { render, screen, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from './config';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
const store = vi.hoisted(() => ({
  currentUser: { id: 'u1', familyId: 'f1', role: 'parent', displayName: 'Sam Smith', rewardPoints: 120 },
  familyMembers: [] as any[],
  familyData: { name: 'Smith Family' },
  tasks: [] as any[],
  taskCompletions: [] as any[],
  rewards: [] as any[],
  redemptions: [] as any[],
  challenges: [] as any[],
  behaviourEvents: [] as any[],
  loading: false,
}));

vi.mock('../store/useStore', () => ({ useStore: () => store }));

const api = vi.hoisted(() => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
  createReward: vi.fn(),
  updateReward: vi.fn(),
  redeemReward: vi.fn(),
  createChallenge: vi.fn(),
  claimChallenge: vi.fn(),
}));
vi.mock('../lib/api', () => api);

vi.mock('../lib/roles', () => ({
  isParentRole: (role: string) => role === 'parent' || role === 'owner',
  isChildRole: (role: string) => role === 'child',
  getRoleLabel: (role: string) => role,
}));

vi.mock('../components/reversals/HistoryActionControl', () => ({
  HistoryActionControl: () => null,
}));

import { TaskFormModal } from '../components/forms/TaskFormModal';
import { RewardFormModal } from '../components/forms/RewardFormModal';
import { Rewards } from '../pages/Rewards';
import { Tasks } from '../pages/Tasks';
import { DashboardHeader } from '../components/parent/dashboard/DashboardHeader';
import { Family } from '../pages/Family';

const withRouter = (ui: React.ReactNode) => <MemoryRouter>{ui}</MemoryRouter>;

beforeEach(async () => {
  vi.clearAllMocks();
  store.currentUser = { id: 'u1', familyId: 'f1', role: 'parent', displayName: 'Sam Smith', rewardPoints: 120 };
  store.familyMembers = [];
  store.familyData = { name: 'Smith Family' };
  store.tasks = [];
  store.taskCompletions = [];
  store.rewards = [];
  store.redemptions = [];
  store.challenges = [];
  store.behaviourEvents = [];
  store.loading = false;
  await act(async () => { await i18n.changeLanguage('en'); });
});

afterEach(() => {
  cleanup();
});

describe('Parent Core i18n — English rendering', () => {
  it('renders the Dashboard header in English', () => {
    render(withRouter(<DashboardHeader />));
    expect(screen.getByText(/Sam/)).toBeInTheDocument();
    expect(screen.getByText(/happening with your family/)).toBeInTheDocument();
    expect(screen.getByText(/Smith Family/)).toBeInTheDocument();
  });

  it('renders the Task form dialog in English', () => {
    render(<TaskFormModal isOpen onClose={() => {}} />);
    expect(screen.getByText('New Task')).toBeInTheDocument();
    expect(screen.getByText('Task Title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Task' })).toBeInTheDocument();
  });

  it('renders the Reward form dialog in English', () => {
    render(<RewardFormModal isOpen onClose={() => {}} />);
    expect(screen.getByText('New Reward')).toBeInTheDocument();
    expect(screen.getByText('Reward Name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Reward' })).toBeInTheDocument();
  });

  it('renders the Rewards empty state in English', () => {
    render(withRouter(<Rewards />));
    expect(screen.getByText('Rewards')).toBeInTheDocument();
    expect(screen.getByText('No rewards available yet.')).toBeInTheDocument();
  });

  it('renders the Tasks empty state in English', () => {
    render(withRouter(<Tasks />));
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('No active tasks found in this category.')).toBeInTheDocument();
  });

  it('renders the Family page in English', () => {
    render(withRouter(<Family />));
    expect(screen.getByText('Family Hub')).toBeInTheDocument();
  });
});

describe('Parent Core i18n — Turkish rendering', () => {
  beforeEach(async () => {
    await act(async () => { await i18n.changeLanguage('tr'); });
  });

  it('renders the Dashboard header in Turkish', () => {
    render(withRouter(<DashboardHeader />));
    expect(screen.getByText(/Sam/)).toBeInTheDocument();
    expect(screen.getByText(/Smith Family/)).toBeInTheDocument();
  });

  it('renders the Task form dialog in Turkish', () => {
    render(<TaskFormModal isOpen onClose={() => {}} />);
    expect(screen.getByText('Yeni Görev')).toBeInTheDocument();
    expect(screen.getByText('Görev Başlığı')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Görevi Kaydet' })).toBeInTheDocument();
  });

  it('renders the Reward form dialog in Turkish', () => {
    render(<RewardFormModal isOpen onClose={() => {}} />);
    expect(screen.getByText('Yeni Ödül')).toBeInTheDocument();
    expect(screen.getByText('Ödül Adı')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ödülü Kaydet' })).toBeInTheDocument();
  });

  it('renders the Rewards empty state in Turkish', () => {
    render(withRouter(<Rewards />));
    expect(screen.getByText('Ödüller')).toBeInTheDocument();
    expect(screen.getByText('Henüz uygun ödül yok.')).toBeInTheDocument();
  });

  it('renders the Tasks empty state in Turkish', () => {
    render(withRouter(<Tasks />));
    expect(screen.getByText('Görevler')).toBeInTheDocument();
    expect(screen.getByText('Bu kategoride aktif görev bulunamadı.')).toBeInTheDocument();
  });

  it('renders the Family page in Turkish', () => {
    render(withRouter(<Family />));
    expect(screen.getByText('Aile Merkezi')).toBeInTheDocument();
  });
});

describe('Parent Core i18n — language switching', () => {
  it('switches the Task form dialog from English to Turkish', async () => {
    render(<TaskFormModal isOpen onClose={() => {}} />);
    expect(screen.getByText('New Task')).toBeInTheDocument();

    await act(async () => { await i18n.changeLanguage('tr'); });

    expect(screen.getByText('Yeni Görev')).toBeInTheDocument();
    expect(screen.queryByText('New Task')).not.toBeInTheDocument();
  });

  it('switches the Reward form dialog from English to Turkish', async () => {
    render(<RewardFormModal isOpen onClose={() => {}} />);
    expect(screen.getByText('New Reward')).toBeInTheDocument();

    await act(async () => { await i18n.changeLanguage('tr'); });

    expect(screen.getByText('Yeni Ödül')).toBeInTheDocument();
    expect(screen.queryByText('New Reward')).not.toBeInTheDocument();
  });

  it('switches the Rewards empty state from English to Turkish', async () => {
    render(withRouter(<Rewards />));
    expect(screen.getByText('No rewards available yet.')).toBeInTheDocument();

    await act(async () => { await i18n.changeLanguage('tr'); });

    expect(screen.getByText('Henüz uygun ödül yok.')).toBeInTheDocument();
    expect(screen.queryByText('No rewards available yet.')).not.toBeInTheDocument();
  });
});
