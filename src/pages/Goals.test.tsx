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
    fireEvent.change(screen.getAllByPlaceholderText('0.00')[0], { target: { value: '50' } });
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
    fireEvent.change(screen.getAllByPlaceholderText('0.00')[0], { target: { value: '20' } });
    fireEvent.click(screen.getByText('Create Goal'));
    expect(createGoal).toHaveBeenCalledWith('family-1', expect.objectContaining({
      title: 'Lego', kind: 'child', childId: 'child-1', targetAmountPence: 2000,
    }));
  });

  it('passes a fixed parent contribution to createGoal', async () => {
    render(<MemoryRouter><Goals /></MemoryRouter>);
    fireEvent.click(screen.getByText('New Goal'));
    fireEvent.change(screen.getByPlaceholderText('e.g. Family Holiday'), { target: { value: 'Trip' } });
    fireEvent.change(screen.getAllByPlaceholderText('0.00')[0], { target: { value: '50' } });
    // Select the mutually-exclusive "Fixed amount" mode, then fill the fixed input.
    fireEvent.click(screen.getByText('Fixed amount'));
    const fixedInputs = screen.getAllByPlaceholderText('0.00');
    fireEvent.change(fixedInputs[1], { target: { value: '10' } });
    fireEvent.click(screen.getByText('Create Goal'));
    expect(createGoal).toHaveBeenCalledWith('family-1', expect.objectContaining({
      title: 'Trip', kind: 'family', targetAmountPence: 5000,
      parentContribution: { mode: 'fixed', fixedPence: 1000 },
    }));
  });

  it('passes a percentage parent contribution to createGoal', async () => {
    render(<MemoryRouter><Goals /></MemoryRouter>);
    fireEvent.click(screen.getByText('New Goal'));
    fireEvent.change(screen.getByPlaceholderText('e.g. Family Holiday'), { target: { value: 'Trip' } });
    fireEvent.change(screen.getAllByPlaceholderText('0.00')[0], { target: { value: '50' } });
    // Select the mutually-exclusive "Percentage" mode, then fill the percent input.
    fireEvent.click(screen.getByText('Percentage'));
    const percentInput = screen.getByPlaceholderText('0');
    fireEvent.change(percentInput, { target: { value: '20' } });
    fireEvent.click(screen.getByText('Create Goal'));
    expect(createGoal).toHaveBeenCalledWith('family-1', expect.objectContaining({
      title: 'Trip', kind: 'family', targetAmountPence: 5000,
      parentContribution: { mode: 'percent', percent: 20 },
    }));
  });

  it('does not pass parentContribution when blank', async () => {
    render(<MemoryRouter><Goals /></MemoryRouter>);
    fireEvent.click(screen.getByText('New Goal'));
    fireEvent.change(screen.getByPlaceholderText('e.g. Family Holiday'), { target: { value: 'Trip' } });
    fireEvent.change(screen.getAllByPlaceholderText('0.00')[0], { target: { value: '50' } });
    fireEvent.click(screen.getByText('Create Goal'));
    const call = (createGoal as any).mock.calls[0][1];
    expect(call.parentContribution).toBeUndefined();
  });

  it('switching parent mode clears the inactive value without resetting title/target', async () => {
    render(<MemoryRouter><Goals /></MemoryRouter>);
    fireEvent.click(screen.getByText('New Goal'));
    fireEvent.change(screen.getByPlaceholderText('e.g. Family Holiday'), { target: { value: 'Trip' } });
    fireEvent.change(screen.getAllByPlaceholderText('0.00')[0], { target: { value: '50' } });
    // Pick fixed, enter a value.
    fireEvent.click(screen.getByText('Fixed amount'));
    const fixedInputs = screen.getAllByPlaceholderText('0.00');
    fireEvent.change(fixedInputs[1], { target: { value: '10' } });
    // Switch to percentage: the fixed input must be gone (cleared), title/target kept.
    fireEvent.click(screen.getByText('Percentage'));
    // Only the target input (placeholder "0.00") remains; the fixed input is removed.
    expect(screen.getAllByPlaceholderText('0.00')).toHaveLength(1);
    expect((screen.getByPlaceholderText('e.g. Family Holiday') as HTMLInputElement).value).toBe('Trip');
    expect((screen.getAllByPlaceholderText('0.00')[0] as HTMLInputElement).value).toBe('50');
  });

  it('preserves title/target/type/child when changing contribution controls (no reset)', async () => {
    render(<MemoryRouter><Goals /></MemoryRouter>);
    fireEvent.click(screen.getByText('New Goal'));
    fireEvent.change(screen.getByPlaceholderText('e.g. Family Holiday'), { target: { value: 'Trip' } });
    fireEvent.change(screen.getAllByPlaceholderText('0.00')[0], { target: { value: '50' } });
    fireEvent.click(screen.getByText('Fixed amount'));
    const fixedInputs = screen.getAllByPlaceholderText('0.00');
    fireEvent.change(fixedInputs[1], { target: { value: '10' } });
    // Title and target must still hold their values after editing contribution.
    expect((screen.getByPlaceholderText('e.g. Family Holiday') as HTMLInputElement).value).toBe('Trip');
    expect((screen.getAllByPlaceholderText('0.00')[0] as HTMLInputElement).value).toBe('50');
  });

  it('mobile Create Goal flow keeps focus on the active field', async () => {
    render(<MemoryRouter><Goals /></MemoryRouter>);
    fireEvent.click(screen.getByText('New Goal'));
    const titleInput = screen.getByPlaceholderText('e.g. Family Holiday') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Trip' } });
    // Typing in the title must not remount/reset the form (focus + values preserved).
    expect(titleInput.value).toBe('Trip');
    fireEvent.click(screen.getByText('Fixed amount'));
    const fixedInputs = screen.getAllByPlaceholderText('0.00');
    const fixedInput = fixedInputs[1] as HTMLInputElement;
    fireEvent.change(fixedInput, { target: { value: '10' } });
    // The fixed contribution value is applied and the title is untouched (no reset).
    expect(fixedInput.value).toBe('10');
    expect(titleInput.value).toBe('Trip');
  });
});
