import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  createReward: vi.fn(),
  updateReward: vi.fn(),
  redeemReward: vi.fn(),
}));
vi.mock('../lib/api', () => api);

const useStoreMock = vi.fn();
vi.mock('../store/useStore', () => ({ useStore: (...args: any[]) => useStoreMock(...args) }));

import { Rewards } from './Rewards';

const baseReward = {
  id: 'r1',
  title: 'Extra Screen Time',
  cost: 50,
  icon: 'Gift',
  isActive: true,
  inventory: null,
};

function makeStore(overrides: any = {}) {
  return {
    currentUser: { id: 'u1', familyId: 'fam', role: 'owner', rewardPoints: 100 },
    rewards: [baseReward],
    redemptions: [],
    loading: false,
    ...overrides,
  };
}

describe('Rewards page — role-based management controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.createReward.mockResolvedValue({ id: 'r1' });
    api.updateReward.mockResolvedValue(undefined);
    api.redeemReward.mockResolvedValue(undefined);
    vi.stubGlobal('confirm', () => true);
  });

  it('owner sees Add Reward, Edit and Archive controls', () => {
    useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'owner', rewardPoints: 100 } }));
    render(<Rewards />);
    expect(screen.getByRole('button', { name: 'Add Reward' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Extra Screen Time'));
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Redeem Reward' })).not.toBeInTheDocument();
  });

  it('parent sees Add Reward, Edit and Archive controls', () => {
    useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'parent', rewardPoints: 100 } }));
    render(<Rewards />);
    expect(screen.getByRole('button', { name: 'Add Reward' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('Extra Screen Time'));
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
  });

  it('child only sees Redeem controls and no management controls', () => {
    useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'child', rewardPoints: 100 } }));
    render(<Rewards />);
    expect(screen.queryByRole('button', { name: 'Add Reward' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Extra Screen Time'));
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Redeem Reward' })).toBeInTheDocument();
  });
});

describe('Rewards page — edit and delete (soft archive)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.updateReward.mockResolvedValue(undefined);
    vi.stubGlobal('confirm', () => true);
  });

  it('owner can edit a reward (updateReward is called)', async () => {
    useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'owner', rewardPoints: 100 } }));
    render(<Rewards />);
    fireEvent.click(screen.getByText('Extra Screen Time'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    // Edit form is open.
    expect(screen.getByText('Edit Reward')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save Reward' }));
    await waitFor(() => expect(api.updateReward).toHaveBeenCalledTimes(1));
    const [familyId, id, payload] = api.updateReward.mock.calls[0];
    expect(familyId).toBe('fam');
    expect(id).toBe('r1');
    expect(payload.title).toBe('Extra Screen Time');
  });

  it('owner can archive (soft-delete) a reward via updateReward isActive:false', async () => {
    useStoreMock.mockReturnValue(makeStore({ currentUser: { id: 'u1', familyId: 'fam', role: 'owner', rewardPoints: 100 } }));
    render(<Rewards />);
    fireEvent.click(screen.getByText('Extra Screen Time'));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(api.updateReward).toHaveBeenCalledTimes(1));
    const [, , payload] = api.updateReward.mock.calls[0];
    expect(payload).toMatchObject({ isActive: false });
  });
});
