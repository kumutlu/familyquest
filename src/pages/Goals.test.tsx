import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const mockStore: any = {
  currentUser: { id: 'parent-1', familyId: 'family-1', role: 'parent', displayName: 'Parent' },
  familyData: { id: 'family-1', currency: '£' },
  savingsGoals: [],
  familyMembers: [
    { id: 'child-1', role: 'child', displayName: 'Alice' },
    { id: 'child-2', role: 'child', displayName: 'Bob' },
  ],
  loading: false,
  bootstrapError: null,
  featureErrors: {},
  bootstrapStatus: {},
  retryBootstrap: vi.fn(),
};

vi.mock('../store/useStore', () => ({ useStore: () => mockStore }));
vi.mock('../lib/api', () => ({
  createGoal: vi.fn().mockResolvedValue(undefined),
}));

import { Goals } from './Goals';
import { createGoal } from '../lib/api';

beforeEach(() => {
  mockStore.currentUser = { id: 'parent-1', familyId: 'family-1', role: 'parent', displayName: 'Parent' };
  mockStore.savingsGoals = [];
  mockStore.familyMembers = [
    { id: 'child-1', role: 'child', displayName: 'Alice' },
    { id: 'child-2', role: 'child', displayName: 'Bob' },
  ];
  (createGoal as any).mockClear();
});

describe('Goals list page', () => {
  it('renders empty family and child goal sections', () => {
    render(<MemoryRouter><Goals /></MemoryRouter>);
    expect(screen.getByText('Goals')).toBeInTheDocument();
    expect(screen.getByText('Family Goals')).toBeInTheDocument();
    expect(screen.getByText('Child Goals')).toBeInTheDocument();
  });

  it('separates family and child goals', () => {
    mockStore.savingsGoals = [
      { id: 'g1', title: 'Holiday', kind: 'family', targetAmountPence: 10000, currentAmountPence: 0, status: 'active', version: 1 },
      { id: 'g2', title: 'Bike', kind: 'child', childId: 'child-1', targetAmountPence: 5000, currentAmountPence: 0, status: 'active', version: 1 },
    ];
    render(<MemoryRouter><Goals /></MemoryRouter>);
    expect(screen.getByText('Holiday')).toBeInTheDocument();
    expect(screen.getByText('Bike')).toBeInTheDocument();
  });

  it('creates a family goal via the modal', async () => {
    render(<MemoryRouter><Goals /></MemoryRouter>);
    fireEvent.click(screen.getByText('New Goal'));
    fireEvent.change(screen.getByPlaceholderText('e.g. Family Holiday'), { target: { value: 'Trip' } });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '50' } });
    fireEvent.click(screen.getByText('Create Goal'));
    expect(createGoal).toHaveBeenCalledWith('family-1', expect.objectContaining({
      title: 'Trip', kind: 'family', targetAmountPence: 5000,
    }));
  });

  it('creates a child goal and passes childId', async () => {
    render(<MemoryRouter><Goals /></MemoryRouter>);
    fireEvent.click(screen.getByText('New Goal'));
    fireEvent.click(screen.getByText('🎯 Child'));
    fireEvent.change(screen.getByPlaceholderText('e.g. Family Holiday'), { target: { value: 'Lego' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'child-1' } });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '20' } });
    fireEvent.click(screen.getByText('Create Goal'));
    expect(createGoal).toHaveBeenCalledWith('family-1', expect.objectContaining({
      title: 'Lego', kind: 'child', childId: 'child-1', targetAmountPence: 2000,
    }));
  });
});
